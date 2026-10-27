/** @format */

import { Router } from "express";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db, contactsTable, inventoryItemsTable } from "../db";
import { planningPurchaseRequisitionsTable, purchaseOrderItemsTable, purchaseOrdersTable, purchaseRequisitionsTable, type PurchaseOrder, type PurchaseOrderItem } from "../db/schema";
import { requireAuth, requirePermission, requireRole } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { applyStockMovement } from "../lib/stock";
import { writeAuditEvent } from "../lib/governance";
import { nextPhase0Number } from "../lib/phase0";
import { PO_READ_ROLES, PoError, allowedPoMoves, canEditPo, canReceiveIn, canSeePoPrices, isPoApprover, isPoStatus, orderTotal, planReceipt, type PoStatus } from "../lib/purchasing";

const router = Router();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const qtyRe = /^\d+(\.\d{1,3})?$/;
const priceRe = /^\d+(\.\d{1,2})?$/;
const itemSchema = z.object({
  inventoryItemId: z.number().int().positive(),
  qty: z.string().regex(qtyRe, "الكمية غير صحيحة").refine((v) => Number(v) > 0, "الكمية لازم تكون أكبر من صفر"),
  unitPrice: z.string().regex(priceRe, "السعر غير صحيح").default("0"),
  requisition: z.object({ source: z.enum(["ops", "plan"]), id: z.number().int().positive() }).optional(),
});
const bodySchema = z.object({
  supplierId: z.number().int().positive(),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  items: z.array(itemSchema).min(1, "أضف بند واحد على الأقل").max(100),
});
type Body = z.infer<typeof bodySchema>;

const err = (message: string, status = 400) => new PoError(message, status);

/** الاحتياج بيتقفل (ordered) لما ينضم لأمر، وبيرجع لحالته الأصلية لو الأمر اتلغى أو اتعدّل. */
async function claim(tx: Tx, items: Array<{ requisition?: { source: "ops" | "plan"; id: number } | null }>) {
  for (const it of items) {
    const r = it.requisition;
    if (!r) continue;
    const rows =
      r.source === "ops"
        ? await tx.update(purchaseRequisitionsTable).set({ status: "ordered" }).where(and(eq(purchaseRequisitionsTable.id, r.id), eq(purchaseRequisitionsTable.status, "confirmed_to_procurement"))).returning({ id: purchaseRequisitionsTable.id })
        : await tx.update(planningPurchaseRequisitionsTable).set({ status: "ordered" }).where(and(eq(planningPurchaseRequisitionsTable.id, r.id), eq(planningPurchaseRequisitionsTable.status, "draft"))).returning({ id: planningPurchaseRequisitionsTable.id });
    if (!rows.length) throw err("أحد الاحتياجات تم تحويله لأمر شراء قبل كده أو مش متاح", 409);
  }
}
async function release(tx: Tx, items: Array<{ requisitionSource: string | null; requisitionId: number | null }>) {
  for (const it of items) {
    if (!it.requisitionId) continue;
    if (it.requisitionSource === "ops") await tx.update(purchaseRequisitionsTable).set({ status: "confirmed_to_procurement" }).where(and(eq(purchaseRequisitionsTable.id, it.requisitionId), eq(purchaseRequisitionsTable.status, "ordered")));
    else if (it.requisitionSource === "plan") await tx.update(planningPurchaseRequisitionsTable).set({ status: "draft" }).where(and(eq(planningPurchaseRequisitionsTable.id, it.requisitionId), eq(planningPurchaseRequisitionsTable.status, "ordered")));
  }
}

/** بيجهّز بنود الأمر: بيتأكد من الصنف ويثبّت اسمه ووحدته وقت الإنشاء. */
async function buildItems(tx: Tx, items: Body["items"]) {
  const ids = [...new Set(items.map((i) => i.inventoryItemId))];
  const inv = await tx.select({ id: inventoryItemsTable.id, name: inventoryItemsTable.name, unit: inventoryItemsTable.unit }).from(inventoryItemsTable).where(inArray(inventoryItemsTable.id, ids));
  const by = new Map(inv.map((i) => [i.id, i]));
  return items.map((i) => {
    const it = by.get(i.inventoryItemId);
    if (!it) throw err(`الصنف رقم ${i.inventoryItemId} مش موجود في المخزون`, 404);
    return { inventoryItemId: i.inventoryItemId, description: it.name, unit: it.unit, qty: i.qty, unitPrice: i.unitPrice, requisition: i.requisition };
  });
}
async function checkSupplier(tx: Tx, supplierId: number) {
  const [s] = await tx.select({ id: contactsTable.id, type: contactsTable.type }).from(contactsTable).where(eq(contactsTable.id, supplierId)).limit(1);
  if (!s || (s.type !== "supplier" && s.type !== "both")) throw err("المورد مش موجود أو مش متسجّل كمورّد", 400);
}

function shape(po: PurchaseOrder, items: PurchaseOrderItem[], supplierName: string | null, role: string) {
  const prices = canSeePoPrices(role);
  return {
    id: po.id,
    poNumber: po.poNumber,
    supplierId: po.supplierId,
    supplierName,
    status: po.status,
    expectedDate: po.expectedDate,
    notes: po.notes,
    ...(prices ? { total: po.total } : {}),
    createdByName: po.createdByName,
    approvedAt: po.approvedAt,
    sentAt: po.sentAt,
    cancelReason: po.cancelReason,
    createdAt: po.createdAt,
    updatedAt: po.updatedAt,
    items: items.map((i) => ({
      id: i.id,
      inventoryItemId: i.inventoryItemId,
      description: i.description,
      unit: i.unit,
      qty: i.qty,
      receivedQty: i.receivedQty,
      ...(prices ? { unitPrice: i.unitPrice } : {}),
      requisitionSource: i.requisitionSource,
      requisitionId: i.requisitionId,
    })),
  };
}
async function load(id: number, role: string) {
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id)).limit(1);
  if (!po) return null;
  const items = await db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.poId, id)).orderBy(purchaseOrderItemsTable.id);
  const [sup] = await db.select({ name: contactsTable.name }).from(contactsTable).where(eq(contactsTable.id, po.supplierId)).limit(1);
  return shape(po, items, sup?.name ?? null, role);
}

function handle(res: import("express").Response, next: import("express").NextFunction, e: unknown) {
  if (e instanceof PoError) {
    res.status(e.status).json({ error: { message: e.message } });
    return;
  }
  next(e);
}

// GET /api/v1/purchases/suppliers — الموردين لاختيار مورد الأمر (/contacts مقفول على المشتريات)
router.get("/purchases/suppliers", requireAuth, requireRole("chairman", "executive_manager", "purchasing_manager", "buyer"), async (_req, res, next) => {
  try {
    res.json(await db.select({ id: contactsTable.id, name: contactsTable.name }).from(contactsTable).where(or(eq(contactsTable.type, "supplier"), eq(contactsTable.type, "both"))).orderBy(asc(contactsTable.name)));
  } catch (e) {
    next(e);
  }
});

// GET /api/v1/purchases/needs — احتياجات الشراء المفتوحة من الإنتاج والتخطيط (كل واحد بمصدره)
router.get("/purchases/needs", requireAuth, requireRole("chairman", "executive_manager", "purchasing_manager", "buyer"), async (_req, res, next) => {
  try {
    const ops = await db
      .select({ id: purchaseRequisitionsTable.id, inventoryItemId: purchaseRequisitionsTable.inventoryItemId, materialName: purchaseRequisitionsTable.materialName, qty: purchaseRequisitionsTable.shortageQty, reason: purchaseRequisitionsTable.reason, createdAt: purchaseRequisitionsTable.createdAt, unit: inventoryItemsTable.unit, supplierId: inventoryItemsTable.supplierId })
      .from(purchaseRequisitionsTable)
      .leftJoin(inventoryItemsTable, eq(inventoryItemsTable.id, purchaseRequisitionsTable.inventoryItemId))
      .where(eq(purchaseRequisitionsTable.status, "confirmed_to_procurement"));
    const plan = await db
      .select({ id: planningPurchaseRequisitionsTable.id, number: planningPurchaseRequisitionsTable.requisitionNumber, inventoryItemId: planningPurchaseRequisitionsTable.inventoryItemId, materialName: inventoryItemsTable.name, qty: planningPurchaseRequisitionsTable.requestedQty, createdAt: planningPurchaseRequisitionsTable.createdAt, unit: inventoryItemsTable.unit, supplierId: inventoryItemsTable.supplierId })
      .from(planningPurchaseRequisitionsTable)
      .innerJoin(inventoryItemsTable, eq(inventoryItemsTable.id, planningPurchaseRequisitionsTable.inventoryItemId))
      .where(eq(planningPurchaseRequisitionsTable.status, "draft"));
    const supIds = [...new Set([...ops, ...plan].map((r) => r.supplierId).filter((v): v is number => !!v))];
    const sups = supIds.length ? await db.select({ id: contactsTable.id, name: contactsTable.name }).from(contactsTable).where(inArray(contactsTable.id, supIds)) : [];
    const supName = new Map(sups.map((s) => [s.id, s.name]));
    const rows = [
      ...ops.map((r) => ({ source: "ops" as const, id: r.id, number: `OC-${r.id}`, inventoryItemId: r.inventoryItemId, name: r.materialName, unit: r.unit ?? null, qty: r.qty, reason: r.reason, supplierId: r.supplierId ?? null, supplierName: r.supplierId ? supName.get(r.supplierId) ?? null : null, createdAt: r.createdAt, orderable: !!r.inventoryItemId })),
      ...plan.map((r) => ({ source: "plan" as const, id: r.id, number: r.number, inventoryItemId: r.inventoryItemId as number | null, name: r.materialName, unit: r.unit ?? null, qty: r.qty, reason: null as string | null, supplierId: r.supplierId ?? null, supplierName: r.supplierId ? supName.get(r.supplierId) ?? null : null, createdAt: r.createdAt, orderable: true })),
    ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// GET /api/v1/purchases
router.get("/purchases", requireAuth, requireRole(...PO_READ_ROLES), async (req, res, next) => {
  try {
    const role = req.user!.role;
    const { status } = req.query as { status?: string };
    const pos = await db
      .select()
      .from(purchaseOrdersTable)
      .where(status && isPoStatus(status) ? eq(purchaseOrdersTable.status, status) : undefined)
      .orderBy(desc(purchaseOrdersTable.createdAt))
      .limit(500);
    const ids = pos.map((p) => p.id);
    const items = ids.length ? await db.select().from(purchaseOrderItemsTable).where(inArray(purchaseOrderItemsTable.poId, ids)) : [];
    const supIds = [...new Set(pos.map((p) => p.supplierId))];
    const sups = supIds.length ? await db.select({ id: contactsTable.id, name: contactsTable.name }).from(contactsTable).where(inArray(contactsTable.id, supIds)) : [];
    const supName = new Map(sups.map((s) => [s.id, s.name]));
    const prices = canSeePoPrices(role);
    res.json(
      pos.map((p) => {
        const its = items.filter((i) => i.poId === p.id);
        const ordered = its.reduce((s, i) => s + Number(i.qty), 0);
        const received = its.reduce((s, i) => s + Number(i.receivedQty), 0);
        return { id: p.id, poNumber: p.poNumber, supplierId: p.supplierId, supplierName: supName.get(p.supplierId) ?? null, status: p.status, expectedDate: p.expectedDate, createdAt: p.createdAt, itemsCount: its.length, orderedQty: String(ordered), receivedQty: String(received), ...(prices ? { total: p.total } : {}) };
      }),
    );
  } catch (e) {
    next(e);
  }
});

// GET /api/v1/purchases/:id
router.get("/purchases/:id", requireAuth, requireRole(...PO_READ_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const po = await load(id, req.user!.role);
    if (!po) {
      res.status(404).json({ error: { message: "أمر الشراء غير موجود" } });
      return;
    }
    res.json(po);
  } catch (e) {
    next(e);
  }
});

// POST /api/v1/purchases — أمر جديد (مسودة)
router.post("/purchases", requireAuth, requirePermission("purchases.create"), async (req, res, next) => {
  try {
    const data = bodySchema.parse(req.body);
    const id = await db.transaction(async (tx) => {
      await checkSupplier(tx, data.supplierId);
      const items = await buildItems(tx, data.items);
      await claim(tx, items);
      const poNumber = await nextPhase0Number(tx, "purchase_order");
      const [po] = await tx
        .insert(purchaseOrdersTable)
        .values({ poNumber, supplierId: data.supplierId, expectedDate: data.expectedDate ?? null, notes: data.notes ?? null, total: String(orderTotal(items)), createdBy: req.user!.userId, createdByName: req.user!.username })
        .returning();
      await tx.insert(purchaseOrderItemsTable).values(items.map((i) => ({ poId: po!.id, inventoryItemId: i.inventoryItemId, description: i.description, unit: i.unit, qty: i.qty, unitPrice: i.unitPrice, requisitionSource: i.requisition?.source ?? null, requisitionId: i.requisition?.id ?? null })));
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "purchases.create", resourceType: "purchase_order", resourceId: po!.id, afterData: { poNumber, supplierId: data.supplierId, items: items.length }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      return po!.id;
    });
    res.status(201).json(await load(id, req.user!.role));
  } catch (e) {
    handle(res, next, e);
  }
});

// PATCH /api/v1/purchases/:id — تعديل المسودة بس (المورد والتاريخ والملاحظات والبنود)
router.patch("/purchases/:id", requireAuth, requirePermission("purchases.edit"), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const data = bodySchema.parse(req.body);
    await db.transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id)).for("update");
      if (!po) throw err("أمر الشراء غير موجود", 404);
      if (!isPoStatus(po.status) || !canEditPo(po.status)) throw err("التعديل متاح للمسودة بس", 409);
      await checkSupplier(tx, data.supplierId);
      const old = await tx.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.poId, id));
      await release(tx, old);
      const items = await buildItems(tx, data.items);
      await claim(tx, items);
      await tx.delete(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.poId, id));
      await tx.insert(purchaseOrderItemsTable).values(items.map((i) => ({ poId: id, inventoryItemId: i.inventoryItemId, description: i.description, unit: i.unit, qty: i.qty, unitPrice: i.unitPrice, requisitionSource: i.requisition?.source ?? null, requisitionId: i.requisition?.id ?? null })));
      await tx.update(purchaseOrdersTable).set({ supplierId: data.supplierId, expectedDate: data.expectedDate ?? null, notes: data.notes ?? null, total: String(orderTotal(items)), updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, id));
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "purchases.edit", resourceType: "purchase_order", resourceId: id, afterData: { items: items.length }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
    });
    res.json(await load(id, req.user!.role));
  } catch (e) {
    handle(res, next, e);
  }
});

// POST /api/v1/purchases/:id/status — إرسال للاعتماد / اعتماد / رجوع للمسودة / إرسال للمورد / إلغاء
const statusSchema = z.object({ status: z.string(), reason: z.string().max(300).optional().nullable() });
router.post("/purchases/:id/status", requireAuth, requirePermission("purchases.create"), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const { status: to, reason } = statusSchema.parse(req.body);
    if (!isPoStatus(to)) throw err("حالة غير معروفة");
    const role = req.user!.role;
    await db.transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id)).for("update");
      if (!po || !isPoStatus(po.status)) throw err("أمر الشراء غير موجود", 404);
      if (!allowedPoMoves(po.status, role).includes(to)) {
        throw err(to === "approved" && !isPoApprover(role) ? "اعتماد أمر الشراء لمدير المشتريات أو رئيس المجلس" : "الانتقال ده مش متاح للأمر في حالته الحالية", 409);
      }
      const items = await tx.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.poId, id));
      if ((to === "pending_approval" || to === "approved") && items.some((i) => !(Number(i.unitPrice) > 0))) throw err("حدد سعر لكل البنود قبل الإرسال للاعتماد");
      if (to === "cancelled") {
        if (!reason?.trim()) throw err("اكتب سبب الإلغاء");
        await release(tx, items);
      }
      const set: Partial<typeof purchaseOrdersTable.$inferInsert> = { status: to as PoStatus, updatedAt: new Date() };
      if (to === "approved") Object.assign(set, { approvedBy: req.user!.userId, approvedAt: new Date() });
      if (to === "sent") set.sentAt = new Date();
      if (to === "cancelled") set.cancelReason = reason!.trim();
      await tx.update(purchaseOrdersTable).set(set).where(eq(purchaseOrdersTable.id, id));
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: `purchases.${to}`, resourceType: "purchase_order", resourceId: id, beforeData: { status: po.status }, afterData: { status: to }, reason: reason ?? null, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
    });
    res.json(await load(id, role));
  } catch (e) {
    handle(res, next, e);
  }
});

// POST /api/v1/purchases/:id/receive — استلام (كلّي أو جزئي) بيدخّل المخزون بحركة وارد مرتبطة بالأمر
const receiveSchema = z.object({
  lines: z.array(z.object({ itemId: z.number().int().positive(), qty: z.string() })).min(1),
  notes: z.string().max(300).optional().nullable(),
});
router.post("/purchases/:id/receive", requireAuth, requirePermission("inventory.receivePurchase"), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const data = receiveSchema.parse(req.body);
    await db.transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id)).for("update");
      if (!po || !isPoStatus(po.status)) throw err("أمر الشراء غير موجود", 404);
      if (!canReceiveIn(po.status)) throw err("الأمر لازم يكون معتمد قبل الاستلام", 409);
      const items = await tx.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.poId, id));
      const plan = planReceipt(items.map((i) => ({ id: i.id, qty: i.qty, receivedQty: i.receivedQty })), data.lines);
      const by = new Map(items.map((i) => [i.id, i]));
      for (const l of data.lines) {
        const it = by.get(l.itemId)!;
        await applyStockMovement(tx, { inventoryItemId: it.inventoryItemId, movementType: "in", qty: l.qty, referenceType: "purchase", referenceId: po.id, unitPrice: it.unitPrice, notes: [`استلام ${po.poNumber}`, data.notes?.trim()].filter(Boolean).join(" — ") });
      }
      for (const n of plan.next) await tx.update(purchaseOrderItemsTable).set({ receivedQty: n.receivedQty }).where(eq(purchaseOrderItemsTable.id, n.id));
      await tx.update(purchaseOrdersTable).set({ status: plan.status, updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, id));
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "purchases.receive", resourceType: "purchase_order", resourceId: id, beforeData: { status: po.status }, afterData: { status: plan.status, lines: data.lines }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
    });
    res.json(await load(id, req.user!.role));
  } catch (e) {
    if (e instanceof Error && "status" in e && !(e instanceof PoError)) {
      res.status((e as Error & { status: number }).status).json({ error: { message: e.message } });
      return;
    }
    handle(res, next, e);
  }
});

export default router;
