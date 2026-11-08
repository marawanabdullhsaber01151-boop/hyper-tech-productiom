/** @format */
// التقارير القابلة للتصدير (الخطوة 41أ): مبيعات ومخزون ومشتريات. معاينة JSON + تصدير Excel/CSV. الحسابات النقية في src/domain/reports.ts.
import { Router } from "express";
import { and, asc, desc, eq, gte, lt, lte, notInArray, sql } from "drizzle-orm";
import { contactsTable, db, inventoryItemsTable, productionWorkflowOrdersTable, purchaseOrdersTable, salesOrdersTable } from "../db";
import { isIsoDate, reportRange } from "../domain/oee";
import {
  PRODUCTION_COST_ROLES, PRODUCTION_STATUS_LABEL, REPORT_ROLES, REPORT_TITLES, ROW_LIMIT, SALES_STATUS_LABEL, csvRows, exportFileName, inventoryReport, isReportId, needsRange, productionReport, purchasesReport, reportsFor, salesReport,
  type ReportId, type ReportResult,
} from "../domain/reports";
import { writeAuditEvent } from "../lib/governance";
import { toCsv } from "../lib/csv";
import { buildXlsx } from "../lib/xlsxWriter";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use("/reports", requireAuth);

const bad = (message: string) => Object.assign(new Error(message), { status: 400 });
const forbidden = () => Object.assign(new Error("ليس لديك صلاحية لهذا التقرير"), { status: 403 });
const q = (v: unknown): string => (typeof v === "string" ? v : "");

// GET /api/v1/reports — التقارير المتاحة لدور المستخدم
router.get("/reports", (req, res) => {
  res.json(reportsFor(req.user!.role).map((id) => ({ id, title: REPORT_TITLES[id], needsRange: needsRange(id) })));
});

async function load(id: ReportId, from: string, to: string, status: string, role: string): Promise<ReportResult> {
  if (id === "inventory") {
    const rows = await db.select({
      code: inventoryItemsTable.code, name: inventoryItemsTable.name, category: inventoryItemsTable.category, unit: inventoryItemsTable.unit,
      qty: inventoryItemsTable.qty, reservedQty: inventoryItemsTable.reservedQty, minQty: inventoryItemsTable.minQty, unitPrice: inventoryItemsTable.unitPrice,
    }).from(inventoryItemsTable).orderBy(asc(inventoryItemsTable.category), asc(inventoryItemsTable.name)).limit(ROW_LIMIT + 1);
    return inventoryReport(rows.slice(0, ROW_LIMIT), rows.length > ROW_LIMIT);
  }
  if (!isIsoDate(from) || !isIsoDate(to)) throw bad("حدد الفترة من تاريخ لتاريخ (YYYY-MM-DD)");
  const range = reportRange(from, to);
  if (!range) throw bad("الفترة غير صالحة (من قبل إلى، وبحد أقصى سنة)");
  if (id === "sales") {
    const cond = [gte(salesOrdersTable.date, from), lte(salesOrdersTable.date, to)];
    if (status) {
      if (!(status in SALES_STATUS_LABEL)) throw bad("حالة غير معروفة");
      cond.push(eq(salesOrdersTable.status, status));
    } else {
      cond.push(notInArray(salesOrdersTable.status, ["draft", "cancelled"]));
    }
    const rows = await db.select({
      orderNumber: salesOrdersTable.orderNumber, date: salesOrdersTable.date, customer: contactsTable.name, channel: salesOrdersTable.channel,
      status: salesOrdersTable.status, subtotal: salesOrdersTable.subtotal, total: salesOrdersTable.total,
    }).from(salesOrdersTable).leftJoin(contactsTable, eq(salesOrdersTable.contactId, contactsTable.id))
      .where(and(...cond)).orderBy(desc(salesOrdersTable.date), desc(salesOrdersTable.id)).limit(ROW_LIMIT + 1);
    return salesReport(rows.slice(0, ROW_LIMIT), rows.length > ROW_LIMIT);
  }
  if (id === "production") {
    const wo = productionWorkflowOrdersTable;
    const withCost = PRODUCTION_COST_ROLES.includes(role);
    if (status && !(status in PRODUCTION_STATUS_LABEL)) throw bad("حالة غير معروفة");
    const rows = await db.select({
      orderNumber: wo.orderNumber,
      date: sql<string>`to_char(${wo.createdAt} at time zone 'Africa/Cairo', 'YYYY-MM-DD')`,
      productName: wo.productName, status: wo.workflowStatus, orderQty: wo.qty,
      planned: sql<string>`(select coalesce(sum(b.planned_qty), 0)::text from production_batches b where b.workflow_order_id = ${wo.id})`,
      produced: sql<string>`(select coalesce(sum(b.produced_qty), 0)::text from production_batches b where b.workflow_order_id = ${wo.id})`,
      accepted: sql<string>`(select coalesce(sum(b.accepted_qty), 0)::text from production_batches b where b.workflow_order_id = ${wo.id})`,
      scrap: sql<string>`(select coalesce(sum(b.scrap_qty), 0)::text from production_batches b where b.workflow_order_id = ${wo.id})`,
      cost: withCost ? sql<string>`(select coalesce(sum(c.amount), 0)::text from production_cost_entries c where c.workflow_order_id = ${wo.id} and c.status = 'approved')` : sql<string>`'0'`,
    }).from(wo)
      .where(and(gte(wo.createdAt, range.from), lt(wo.createdAt, range.to), status ? eq(wo.workflowStatus, status) : notInArray(wo.workflowStatus, ["cancelled"])))
      .orderBy(desc(wo.createdAt), desc(wo.id)).limit(ROW_LIMIT + 1);
    return productionReport(rows.slice(0, ROW_LIMIT), withCost, rows.length > ROW_LIMIT);
  }
  const rows = await db.select({
    poNumber: purchaseOrdersTable.poNumber,
    date: sql<string>`to_char(${purchaseOrdersTable.createdAt} at time zone 'Africa/Cairo', 'YYYY-MM-DD')`,
    supplier: contactsTable.name, status: purchaseOrdersTable.status, total: purchaseOrdersTable.total,
    orderedQty: sql<string>`(select coalesce(sum(i.qty), 0)::text from purchase_order_items i where i.po_id = ${purchaseOrdersTable.id})`,
    receivedQty: sql<string>`(select coalesce(sum(i.received_qty), 0)::text from purchase_order_items i where i.po_id = ${purchaseOrdersTable.id})`,
  }).from(purchaseOrdersTable).leftJoin(contactsTable, eq(purchaseOrdersTable.supplierId, contactsTable.id))
    .where(and(gte(purchaseOrdersTable.createdAt, range.from), lt(purchaseOrdersTable.createdAt, range.to), status ? eq(purchaseOrdersTable.status, status) : notInArray(purchaseOrdersTable.status, ["draft", "cancelled"])))
    .orderBy(desc(purchaseOrdersTable.createdAt), desc(purchaseOrdersTable.id)).limit(ROW_LIMIT + 1);
  return purchasesReport(rows.slice(0, ROW_LIMIT), rows.length > ROW_LIMIT);
}

// GET /api/v1/reports/:id?from&to&status&format=json|xlsx|csv
router.get("/reports/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!isReportId(id)) { res.status(404).json({ error: { message: "التقرير غير موجود" } }); return; }
    if (!REPORT_ROLES[id].includes(req.user!.role)) throw forbidden();
    const format = q(req.query.format) || "json";
    if (!["json", "xlsx", "csv"].includes(format)) throw bad("صيغة غير مدعومة");
    const from = q(req.query.from); const to = q(req.query.to);
    const report = await load(id, from, to, q(req.query.status), req.user!.role);
    if (format === "json") { res.json({ data: report }); return; }
    // التصدير بيطلّع بيانات برّه النظام فبيتسجّل مين صدّر إيه.
    await writeAuditEvent({
      actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "reports.export", resourceType: "report",
      afterData: { report: id, format, from: from || null, to: to || null, rows: report.rows.length }, decision: "executed", ipAddress: req.ip, userAgent: req.get("user-agent"),
    });
    const name = exportFileName(id, needsRange(id) ? from : null, needsRange(id) ? to : null, format === "xlsx" ? "xlsx" : "csv");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Cache-Control", "no-store");
    if (format === "csv") {
      res.status(200).type("text/csv; charset=utf-8").send(toCsv(csvRows(report)));
      return;
    }
    const xlsx = buildXlsx([{ name: report.title, columns: report.columns.map((c) => ({ header: c.label, kind: c.kind, width: c.kind === "text" ? 22 : 15 })), rows: report.rows, totals: report.totals }]);
    res.status(200).type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(xlsx);
  } catch (err) { next(err); }
});

export default router;
