/** @format */
// اتفاقيات الأسعار (45ب): سعر متفق عليه لمنتج لعميل لفترة. أي طلب عادي جوه الفترة بياخد السعر تلقائيًا ومتقفل (portal.ts).
import { Router } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, bomRecipesTable, portalCustomersTable, priceAgreementsTable } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePortalAuth, getAuthenticatedPortalCustomerId } from "../middleware/portal-auth";
import { PERMISSIONS } from "../lib/permissions";
import { notifyPortalCustomer } from "../lib/portalNotifications";
import { writeAuditEvent } from "../lib/governance";
import { parseIdParam } from "../lib/validate";
import { todayCairo } from "../lib/operationsCapacityCore";
import { AGREEMENT_ISSUE_TEXT, agreementIssues, agreementShown, overlaps } from "../lib/priceAgreementCore";

const router = Router();
const fail = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

const createBody = z.object({
  portalCustomerId: z.number().int().positive(),
  bomRecipeId: z.number().int().positive(),
  unitPrice: z.string().trim().min(1).max(16),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).optional().nullable(),
});

function present(a: typeof priceAgreementsTable.$inferSelect, today: string) {
  return {
    id: a.id,
    portalCustomerId: a.portalCustomerId,
    customerName: a.customerName,
    bomRecipeId: a.bomRecipeId,
    productName: a.productName,
    unitPrice: a.unitPrice,
    validFrom: a.validFrom,
    validUntil: a.validUntil,
    note: a.note,
    status: agreementShown(a, today),
    createdByName: a.createdByName,
    createdAt: a.createdAt,
    endedAt: a.endedAt,
    endedByName: a.endedByName,
    endReason: a.endReason,
  };
}

router.get("/price-agreements", requireAuth, requireRole(...PERMISSIONS.sales.view), async (req, res, next) => {
  try {
    const today = todayCairo(new Date());
    const customerId = Number(req.query.customerId);
    const rows = await db
      .select()
      .from(priceAgreementsTable)
      .where(Number.isInteger(customerId) && customerId > 0 ? eq(priceAgreementsTable.portalCustomerId, customerId) : undefined)
      .orderBy(desc(priceAgreementsTable.id))
      .limit(300);
    const items = rows.map((r) => present(r, today));
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
    res.json({ items, counts });
  } catch (err) {
    next(err);
  }
});

router.post("/price-agreements", requireAuth, requireRole(...PERMISSIONS.sales.write), async (req, res, next) => {
  try {
    const body = createBody.parse(req.body);
    const today = todayCairo(new Date());
    const issues = agreementIssues({ unitPrice: body.unitPrice, validFrom: body.validFrom, validUntil: body.validUntil, today });
    if (issues.length > 0) throw fail(400, issues.map((i) => AGREEMENT_ISSUE_TEXT[i]).join("، "), "AGREEMENT_INVALID");
    const created = await db.transaction(async (tx) => {
      const [customer] = await tx.select().from(portalCustomersTable).where(eq(portalCustomersTable.id, body.portalCustomerId)).limit(1);
      if (!customer) throw fail(404, "العميل غير موجود");
      // قفل صف العميل: اتفاقيتين متزامنتين لنفس العميل ما يعدّوش فحص التداخل مع بعض.
      await tx.select({ id: portalCustomersTable.id }).from(portalCustomersTable).where(eq(portalCustomersTable.id, customer.id)).for("update");
      const [recipe] = await tx.select({ id: bomRecipesTable.id, name: bomRecipesTable.productName, active: bomRecipesTable.isActive }).from(bomRecipesTable).where(eq(bomRecipesTable.id, body.bomRecipeId)).limit(1);
      if (!recipe || !recipe.active) throw fail(400, "المنتج غير موجود أو متوقف", "PRODUCT_INVALID");
      const existing = await tx
        .select()
        .from(priceAgreementsTable)
        .where(and(eq(priceAgreementsTable.portalCustomerId, customer.id), eq(priceAgreementsTable.bomRecipeId, recipe.id), ne(priceAgreementsTable.status, "ended")));
      const clash = existing.find((e) => overlaps(e, body));
      if (clash) throw fail(409, `في اتفاقية شغالة لنفس المنتج في فترة متداخلة (${clash.validFrom} → ${clash.validUntil}). اقفلها الأول أو غيّر التواريخ`, "AGREEMENT_OVERLAP");
      const [row] = await tx
        .insert(priceAgreementsTable)
        .values({
          portalCustomerId: customer.id,
          customerName: customer.companyName ? `${customer.fullName} — ${customer.companyName}` : customer.fullName,
          bomRecipeId: recipe.id,
          productName: recipe.name,
          unitPrice: body.unitPrice,
          validFrom: body.validFrom,
          validUntil: body.validUntil,
          note: body.note || null,
          createdBy: req.user!.userId,
          createdByName: req.user!.username,
        })
        .returning();
      await writeAuditEvent({
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: "agreement.created",
        resourceType: "price_agreement",
        resourceId: row!.id,
        afterData: { customerId: customer.id, recipeId: recipe.id, unitPrice: body.unitPrice, validFrom: body.validFrom, validUntil: body.validUntil },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        executor: tx,
      });
      return row!;
    });
    await notifyPortalCustomer(created.portalCustomerId, {
      type: "portal_price_quote_sent",
      title: "سعر متفق عليه جديد",
      body: `اتفقنا معاك على سعر "${created.productName}" ${created.unitPrice} جنيه للقطعة من ${created.validFrom} لحد ${created.validUntil}. هيتطبق تلقائيًا على طلباتك.`,
      referenceType: "price_quote",
      referenceId: created.id,
    });
    res.status(201).json(present(created, today));
  } catch (err) {
    next(err);
  }
});

const endBody = z.object({ reason: z.string().trim().min(3, "اكتب سبب القفل (3 حروف على الأقل)").max(300) });

router.post("/price-agreements/:id/end", requireAuth, requireRole(...PERMISSIONS.sales.write), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const { reason } = endBody.parse(req.body ?? {});
    const today = todayCairo(new Date());
    const row = await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(priceAgreementsTable).where(eq(priceAgreementsTable.id, id)).for("update").limit(1);
      if (!cur) throw fail(404, "الاتفاقية غير موجودة");
      if (cur.status === "ended") throw fail(409, "الاتفاقية دي مقفولة قبل كده", "ALREADY_ENDED");
      const [updated] = await tx
        .update(priceAgreementsTable)
        .set({ status: "ended", endedAt: new Date(), endedByName: req.user!.username, endReason: reason })
        .where(eq(priceAgreementsTable.id, id))
        .returning();
      await writeAuditEvent({
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: "agreement.ended",
        resourceType: "price_agreement",
        resourceId: id,
        afterData: { customerId: cur.portalCustomerId, recipeId: cur.bomRecipeId },
        reason,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        executor: tx,
      });
      return updated!;
    });
    res.json(present(row, today));
  } catch (err) {
    next(err);
  }
});

/** أسعار العميل المتفق عليها دلوقتي (الشغالة والقادمة) في بوابته. */
router.get("/portal/price-agreements", requirePortalAuth, async (req, res, next) => {
  try {
    const customerId = getAuthenticatedPortalCustomerId(req);
    const today = todayCairo(new Date());
    const rows = await db.select().from(priceAgreementsTable).where(and(eq(priceAgreementsTable.portalCustomerId, customerId), ne(priceAgreementsTable.status, "ended"))).orderBy(priceAgreementsTable.productName);
    const items = rows
      .map((r) => ({ r, shown: agreementShown(r, today) }))
      .filter((x) => x.shown === "active" || x.shown === "upcoming")
      .map(({ r, shown }) => ({ id: r.id, bomRecipeId: r.bomRecipeId, productName: r.productName, unitPrice: r.unitPrice, validFrom: r.validFrom, validUntil: r.validUntil, status: shown }));
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

export default router;
