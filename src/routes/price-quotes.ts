/** @format */
// عروض الأسعار (45أ). الموظف بيعمل عرض لعميل (سطور + سعر + صلاحية) ويبعته، والعميل يطلب منه أو يرفضه.
// الطلب نفسه بيتم من POST /portal/orders بـquoteId (portal.ts) عشان السعر المتفق عليه يتقفل على السطور.
import { Router, Request, Response, NextFunction } from "express";
import { and, desc, eq, ilike, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, bomRecipesTable, portalCustomersTable, portalUsersTable, priceQuoteLinesTable, priceQuotesTable } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePortalAuth, requirePortalPermission, getAuthenticatedPortalCustomerId } from "../middleware/portal-auth";
import { PERMISSIONS } from "../lib/permissions";
import { notifyRoles } from "../lib/notifications";
import { notifyPortalCustomer } from "../lib/portalNotifications";
import { writeAuditEvent } from "../lib/governance";
import { QUOTE_MANAGER_ROLES, sendBlocked } from "../lib/priceAgreementCore";
import { toCents } from "../lib/money";
import { loadSettingValues } from "../lib/settingsStore";
import { parseIdParam } from "../lib/validate";
import { todayCairo } from "../lib/operationsCapacityCore";
import {
  ISSUE_TEXT,
  canCancel,
  canEdit,
  canSend,
  defaultValidUntil,
  effectiveStatus,
  isQuoteStatus,
  nextQuoteNumber,
  quoteIssues,
  quoteTotal,
  type QuoteShownStatus,
} from "../lib/priceQuoteCore";

const router = Router();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const fail = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

const lineSchema = z.object({
  bomRecipeId: z.number().int().positive(),
  qty: z.string().trim().min(1).max(14),
  unitPrice: z.string().trim().min(1).max(16),
});
const quoteBody = z.object({
  portalCustomerId: z.number().int().positive(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
  lines: z.array(lineSchema).max(200),
});

interface QuoteRow {
  id: number;
  quoteNumber: string;
  portalCustomerId: number;
  customerName: string;
  status: string;
  validUntil: string;
  notes: string | null;
  createdByName: string | null;
  sentAt: Date | null;
  decidedAt: Date | null;
  decidedByName: string | null;
  declineReason: string | null;
  cancelReason: string | null;
  batchRef: string | null;
  createdAt: Date;
}
interface LineRow { id: number; quoteId: number; bomRecipeId: number; productName: string; qty: string; unitPrice: string }

function present(q: QuoteRow, lines: LineRow[], today: string) {
  const shown: QuoteShownStatus = effectiveStatus(q.status, q.validUntil, today);
  return {
    id: q.id,
    quoteNumber: q.quoteNumber,
    portalCustomerId: q.portalCustomerId,
    customerName: q.customerName,
    status: shown,
    storedStatus: q.status,
    validUntil: q.validUntil,
    notes: q.notes,
    createdByName: q.createdByName,
    createdAt: q.createdAt,
    sentAt: q.sentAt,
    decidedAt: q.decidedAt,
    decidedByName: q.decidedByName,
    declineReason: q.declineReason,
    cancelReason: q.cancelReason,
    batchRef: q.batchRef,
    total: quoteTotal(lines),
    canEdit: canEdit(q.status),
    canSend: canSend(q.status),
    canCancel: canCancel(q.status),
    lines: lines.map((l) => ({ id: l.id, bomRecipeId: l.bomRecipeId, productName: l.productName, qty: String(Number(l.qty)), unitPrice: l.unitPrice })),
  };
}

async function linesOf(ids: number[]): Promise<Map<number, LineRow[]>> {
  const map = new Map<number, LineRow[]>();
  if (ids.length === 0) return map;
  const rows = await db.select().from(priceQuoteLinesTable).where(inArray(priceQuoteLinesTable.quoteId, ids)).orderBy(priceQuoteLinesTable.id);
  for (const r of rows) {
    const list = map.get(r.quoteId) ?? [];
    list.push(r);
    map.set(r.quoteId, list);
  }
  return map;
}

/** يحفظ سطور العرض بعد التأكد إن كل منتج موجود وشغال (اسم المنتج لقطة وقت العرض). */
async function writeLines(tx: Tx, quoteId: number, lines: z.infer<typeof lineSchema>[]) {
  const recipes = await tx
    .select({ id: bomRecipesTable.id, name: bomRecipesTable.productName, active: bomRecipesTable.isActive })
    .from(bomRecipesTable)
    .where(inArray(bomRecipesTable.id, lines.map((l) => l.bomRecipeId)));
  const byId = new Map(recipes.map((r) => [r.id, r]));
  for (const l of lines) {
    const r = byId.get(l.bomRecipeId);
    if (!r || !r.active) throw fail(400, `منتج غير موجود أو متوقف (رقم ${l.bomRecipeId})`, "PRODUCT_INVALID");
  }
  await tx.delete(priceQuoteLinesTable).where(eq(priceQuoteLinesTable.quoteId, quoteId));
  await tx.insert(priceQuoteLinesTable).values(
    lines.map((l) => ({ quoteId, bomRecipeId: l.bomRecipeId, productName: byId.get(l.bomRecipeId)!.name, qty: l.qty, unitPrice: l.unitPrice })),
  );
}

function checkBody(body: z.infer<typeof quoteBody>, today: string, validUntil: string) {
  const issues = quoteIssues({ lines: body.lines, validUntil, today });
  if (issues.length > 0) throw fail(400, issues.map((i) => ISSUE_TEXT[i]).join("، "), "QUOTE_INVALID");
}

/* ───────────── للموظفين ───────────── */

router.get("/price-quotes", requireAuth, requireRole(...PERMISSIONS.sales.view), async (req, res, next) => {
  try {
    const today = todayCairo(new Date());
    const q = String(req.query.q ?? "").trim().slice(0, 60);
    const status = String(req.query.status ?? "");
    const customerId = Number(req.query.customerId);
    const where = and(
      q ? or(ilike(priceQuotesTable.customerName, `%${q.replace(/[%_]/g, "")}%`), like(priceQuotesTable.quoteNumber, `%${q.toUpperCase().replace(/[%_]/g, "")}%`)) : undefined,
      Number.isInteger(customerId) && customerId > 0 ? eq(priceQuotesTable.portalCustomerId, customerId) : undefined,
    );
    const rows = await db.select().from(priceQuotesTable).where(where).orderBy(desc(priceQuotesTable.id)).limit(300);
    const lines = await linesOf(rows.map((r) => r.id));
    let items = rows.map((r) => present(r, lines.get(r.id) ?? [], today));
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
    if (status && (status === "expired" || isQuoteStatus(status))) items = items.filter((i) => i.status === status);
    res.json({ items, counts });
  } catch (err) {
    next(err);
  }
});

/** بيانات اختيار العميل والمنتج وقت إنشاء العرض (العملاء بالبحث، المنتجات الشغالة). */
router.get("/price-quotes/lookups", requireAuth, requireRole(...PERMISSIONS.sales.view), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim().replace(/[%_]/g, "").slice(0, 60);
    const [companies, recipes, values] = await Promise.all([
      db
        .select({ id: portalCustomersTable.id, fullName: portalCustomersTable.fullName, companyName: portalCustomersTable.companyName })
        .from(portalCustomersTable)
        .where(q ? or(ilike(portalCustomersTable.fullName, `%${q}%`), ilike(portalCustomersTable.companyName, `%${q}%`)) : undefined)
        .orderBy(desc(portalCustomersTable.id))
        .limit(20),
      db
        .select({ id: bomRecipesTable.id, name: bomRecipesTable.productName, referencePrice: bomRecipesTable.referencePrice })
        .from(bomRecipesTable)
        .where(eq(bomRecipesTable.isActive, true))
        .orderBy(bomRecipesTable.productName)
        .limit(500),
      loadSettingValues(),
    ]);
    const days = Number(values["quotes.validity_days"]);
    res.json({
      companies: companies.map((c) => ({ id: c.id, name: c.companyName ? `${c.fullName} — ${c.companyName}` : c.fullName })),
      recipes,
      defaultValidUntil: defaultValidUntil(todayCairo(new Date()), days),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/price-quotes/:id", requireAuth, requireRole(...PERMISSIONS.sales.view), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [row] = await db.select().from(priceQuotesTable).where(eq(priceQuotesTable.id, id)).limit(1);
    if (!row) {
      res.status(404).json({ error: { message: "العرض غير موجود" } });
      return;
    }
    const lines = await linesOf([id]);
    res.json(present(row, lines.get(id) ?? [], todayCairo(new Date())));
  } catch (err) {
    next(err);
  }
});

router.post("/price-quotes", requireAuth, requireRole(...PERMISSIONS.sales.write), async (req, res, next) => {
  try {
    const body = quoteBody.parse(req.body);
    const now = new Date();
    const today = todayCairo(now);
    const values = await loadSettingValues();
    const validUntil = body.validUntil ?? defaultValidUntil(today, Number(values["quotes.validity_days"]));
    checkBody(body, today, validUntil);
    const created = await db.transaction(async (tx) => {
      const [customer] = await tx.select().from(portalCustomersTable).where(eq(portalCustomersTable.id, body.portalCustomerId)).limit(1);
      if (!customer) throw fail(404, "العميل غير موجود");
      await tx.execute(sql`select pg_advisory_xact_lock(4545)`);
      const prefix = nextQuoteNumber(now, null).slice(0, 7);
      const [last] = await tx
        .select({ n: priceQuotesTable.quoteNumber })
        .from(priceQuotesTable)
        .where(like(priceQuotesTable.quoteNumber, `${prefix}-%`))
        .orderBy(desc(priceQuotesTable.quoteNumber))
        .limit(1);
      const [row] = await tx
        .insert(priceQuotesTable)
        .values({
          quoteNumber: nextQuoteNumber(now, last?.n ?? null),
          portalCustomerId: customer.id,
          customerName: customer.companyName ? `${customer.fullName} — ${customer.companyName}` : customer.fullName,
          status: "draft",
          validUntil,
          notes: body.notes || null,
          createdBy: req.user!.userId,
          createdByName: req.user!.username,
        })
        .returning();
      await writeLines(tx, row!.id, body.lines);
      await writeAuditEvent({
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: "quote.created",
        resourceType: "price_quote",
        resourceId: row!.id,
        afterData: { quoteNumber: row!.quoteNumber, customerId: customer.id, lines: body.lines.length, validUntil },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        executor: tx,
      });
      return row!;
    });
    const lines = await linesOf([created.id]);
    res.status(201).json(present(created, lines.get(created.id) ?? [], today));
  } catch (err) {
    next(err);
  }
});

router.put("/price-quotes/:id", requireAuth, requireRole(...PERMISSIONS.sales.write), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const body = quoteBody.parse(req.body);
    const today = todayCairo(new Date());
    const values = await loadSettingValues();
    const validUntil = body.validUntil ?? defaultValidUntil(today, Number(values["quotes.validity_days"]));
    checkBody(body, today, validUntil);
    const saved = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(priceQuotesTable).where(eq(priceQuotesTable.id, id)).for("update").limit(1);
      if (!row) throw fail(404, "العرض غير موجود");
      if (!canEdit(row.status)) throw fail(409, "العرض اتبعت، مينفعش يتعدّل. الغيه واعمل عرض جديد", "NOT_DRAFT");
      const [customer] = await tx.select().from(portalCustomersTable).where(eq(portalCustomersTable.id, body.portalCustomerId)).limit(1);
      if (!customer) throw fail(404, "العميل غير موجود");
      await writeLines(tx, id, body.lines);
      const [updated] = await tx
        .update(priceQuotesTable)
        .set({
          portalCustomerId: customer.id,
          customerName: customer.companyName ? `${customer.fullName} — ${customer.companyName}` : customer.fullName,
          validUntil,
          notes: body.notes || null,
          updatedAt: new Date(),
        })
        .where(eq(priceQuotesTable.id, id))
        .returning();
      await writeAuditEvent({
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: "quote.updated",
        resourceType: "price_quote",
        resourceId: id,
        afterData: { customerId: customer.id, lines: body.lines.length, validUntil },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        executor: tx,
      });
      return updated!;
    });
    const lines = await linesOf([id]);
    res.json(present(saved, lines.get(id) ?? [], today));
  } catch (err) {
    next(err);
  }
});

router.post("/price-quotes/:id/send", requireAuth, requireRole(...PERMISSIONS.sales.write), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const today = todayCairo(new Date());
    const sent = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(priceQuotesTable).where(eq(priceQuotesTable.id, id)).for("update").limit(1);
      if (!row) throw fail(404, "العرض غير موجود");
      if (!canSend(row.status)) throw fail(409, "العرض ده اتبعت قبل كده", "NOT_DRAFT");
      const lines = await tx.select().from(priceQuoteLinesTable).where(eq(priceQuoteLinesTable.quoteId, id));
      const issues = quoteIssues({ lines: lines.map((l) => ({ bomRecipeId: l.bomRecipeId, qty: String(Number(l.qty)), unitPrice: l.unitPrice })), validUntil: row.validUntil, today });
      if (issues.length > 0) throw fail(400, issues.map((i) => ISSUE_TEXT[i]).join("، "), "QUOTE_INVALID");
      const limit = Number((await loadSettingValues())["quotes.approval_limit"]);
      const isManager = (QUOTE_MANAGER_ROLES as readonly string[]).includes(req.user!.role);
      if (sendBlocked({ totalCents: toCents(quoteTotal(lines)), limit, isManager })) {
        throw fail(403, `إجمالي العرض أكبر من ${limit} جنيه، لازم رئيس المجلس أو المدير التنفيذي أو مدير المبيعات هو اللي يبعته`, "NEEDS_MANAGER");
      }
      const [updated] = await tx.update(priceQuotesTable).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(priceQuotesTable.id, id)).returning();
      await writeAuditEvent({
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: "quote.sent",
        resourceType: "price_quote",
        resourceId: id,
        afterData: { quoteNumber: row.quoteNumber, total: quoteTotal(lines), validUntil: row.validUntil },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        executor: tx,
      });
      return { row: updated!, lines };
    });
    await notifyPortalCustomer(sent.row.portalCustomerId, {
      type: "portal_price_quote_sent",
      title: `عرض سعر جديد ${sent.row.quoteNumber}`,
      body: `وصلك عرض سعر بـ${sent.lines.length} ${sent.lines.length === 1 ? "منتج" : "منتجات"}، سارى لحد ${sent.row.validUntil}. تقدر تطلب منه بنفس السعر من صفحة الطلبات.`,
      referenceType: "price_quote",
      referenceId: id,
    });
    res.json(present(sent.row, sent.lines, today));
  } catch (err) {
    next(err);
  }
});

const cancelBody = z.object({ reason: z.string().trim().min(3, "اكتب سبب الإلغاء (3 حروف على الأقل)").max(300) });

router.post("/price-quotes/:id/cancel", requireAuth, requireRole(...PERMISSIONS.sales.write), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const { reason } = cancelBody.parse(req.body ?? {});
    const today = todayCairo(new Date());
    const out = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(priceQuotesTable).where(eq(priceQuotesTable.id, id)).for("update").limit(1);
      if (!row) throw fail(404, "العرض غير موجود");
      if (!canCancel(row.status)) throw fail(409, "العرض ده مينفعش يتلغي (اتطلب منه أو اتلغى أو اترفض)", "NOT_CANCELLABLE");
      const [updated] = await tx
        .update(priceQuotesTable)
        .set({ status: "cancelled", cancelReason: reason, decidedAt: new Date(), decidedByName: req.user!.username, updatedAt: new Date() })
        .where(eq(priceQuotesTable.id, id))
        .returning();
      await writeAuditEvent({
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: "quote.cancelled",
        resourceType: "price_quote",
        resourceId: id,
        afterData: { quoteNumber: row.quoteNumber, wasSent: row.status === "sent" },
        reason,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        executor: tx,
      });
      return { updated: updated!, wasSent: row.status === "sent" };
    });
    if (out.wasSent) {
      await notifyPortalCustomer(out.updated.portalCustomerId, {
        type: "portal_price_quote_sent",
        title: `تم إلغاء عرض السعر ${out.updated.quoteNumber}`,
        body: "المبيعات ألغت العرض ده، ومش هتقدر تطلب منه. تواصل معاهم لو محتاج عرض جديد.",
        referenceType: "price_quote",
        referenceId: id,
      });
    }
    const lines = await linesOf([id]);
    res.json(present(out.updated, lines.get(id) ?? [], today));
  } catch (err) {
    next(err);
  }
});

/* ───────────── للعميل (البوابة) ───────────── */

/** عروض الأسعار زي ما العميل بيشوفها (من غير بيانات داخلية). بتُستخدم في البوابة وفي «شاهد كما يراه العميل». */
export async function portalQuoteItems(customerId: number) {
  const today = todayCairo(new Date());
  const rows = await db
    .select()
    .from(priceQuotesTable)
    .where(and(eq(priceQuotesTable.portalCustomerId, customerId), sql`${priceQuotesTable.status} <> 'draft'`))
    .orderBy(desc(priceQuotesTable.id))
    .limit(100);
  const lines = await linesOf(rows.map((r) => r.id));
  return rows.map((r) => {
    const p = present(r, lines.get(r.id) ?? [], today);
    return {
      id: p.id,
      quoteNumber: p.quoteNumber,
      status: p.status,
      validUntil: p.validUntil,
      notes: p.notes,
      sentAt: p.sentAt,
      decidedAt: p.decidedAt,
      declineReason: p.declineReason,
      batchRef: p.batchRef,
      total: p.total,
      lines: p.lines.map((l) => ({ bomRecipeId: l.bomRecipeId, productName: l.productName, qty: l.qty, unitPrice: l.unitPrice })),
    };
  });
}

router.get("/portal/price-quotes", requirePortalAuth, async (req, res, next) => {
  try {
    res.json({ items: await portalQuoteItems(getAuthenticatedPortalCustomerId(req)) });
  } catch (err) {
    next(err);
  }
});

const declineBody = z.object({ reason: z.string().trim().max(300).optional() });

router.post("/portal/price-quotes/:id/decline", requirePortalAuth, requirePortalPermission("orders.create"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const { reason } = declineBody.parse(req.body ?? {});
    const customerId = getAuthenticatedPortalCustomerId(req);
    const today = todayCairo(new Date());
    const out = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(priceQuotesTable).where(and(eq(priceQuotesTable.id, id), eq(priceQuotesTable.portalCustomerId, customerId))).for("update").limit(1);
      if (!row) throw fail(404, "العرض غير موجود");
      if (effectiveStatus(row.status, row.validUntil, today) !== "sent") throw fail(409, "العرض ده مش متاح للرد عليه", "NOT_OPEN");
      const [who] = await tx.select({ n: portalUsersTable.fullName }).from(portalUsersTable).where(eq(portalUsersTable.id, req.portalAuth!.userId)).limit(1);
      const [updated] = await tx
        .update(priceQuotesTable)
        .set({ status: "declined", declineReason: reason || null, decidedAt: new Date(), decidedByName: who?.n ?? null, updatedAt: new Date() })
        .where(eq(priceQuotesTable.id, id))
        .returning();
      return updated!;
    });
    await notifyRoles([...PERMISSIONS.sales.write], {
      type: "price_quote_declined",
      title: `العميل رفض عرض السعر ${out.quoteNumber}`,
      body: `${out.customerName} رفض العرض${out.declineReason ? ` — السبب: ${out.declineReason}` : ""}.`,
      referenceType: "price_quote",
      referenceId: id,
    });
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.status) {
      res.status(err.status).json({ error: { ...(err.code ? { code: err.code } : {}), message: err.message } });
      return;
    }
    next(err);
  }
});

export default router;
