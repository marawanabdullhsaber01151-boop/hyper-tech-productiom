/** @format */
// حدود الائتمان (52): نظرة لكل العملاء، وتحديد/مسح حد عميل (للإدارة العليا finance، وبسبب مسجّل). ADR 0039.
import { Router } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { writeAuditEvent } from "../lib/governance";
import { creditOverviewData, loadCreditPolicy } from "../lib/credit";
import { parseCreditLimit, storedLimitCents } from "../lib/creditCore";
import { signedDecimal } from "../lib/receivablesCore";

const router = Router();
const view = [requireAuth, requireRole(...PERMISSIONS.finance.view)];
const write = [requireAuth, requireRole(...PERMISSIONS.finance.write)];
const fail = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const dec = (c: bigint | null) => (c === null ? null : signedDecimal(c));

router.get("/credit/overview", ...view, async (_req, res, next) => {
  try {
    const [rows, policy] = await Promise.all([creditOverviewData(db), loadCreditPolicy(db)]);
    res.json({
      policy,
      rows: rows.map((r) => ({ contactId: r.contactId, contactName: r.contactName, limit: dec(r.limitCents), debt: dec(r.debtCents), available: dec(r.availableCents), over: r.over, overBy: dec(r.overByCents) })),
    });
  } catch (err) {
    next(err);
  }
});

const limitBody = z.object({
  contactId: z.number().int().positive(),
  limit: z.union([z.string(), z.number(), z.null()]).optional(),
  reason: z.string().trim().min(3, "اكتب سبب التغيير (3 حروف على الأقل)").max(300),
});

router.put("/credit/limit", ...write, async (req, res, next) => {
  try {
    const body = limitBody.parse(req.body);
    const parsed = parseCreditLimit(body.limit ?? null);
    if (!parsed.ok) throw fail(422, parsed.error, "BAD_LIMIT");
    const out = await db.transaction(async (tx) => {
      const found = (await tx.execute(sql`select id, name, type, credit_limit::text as l from contacts where id = ${body.contactId} for update`)) as { rows: Array<{ id: number; name: string; type: string; l: string | null }> };
      const c = found.rows[0];
      if (!c) throw fail(404, "العميل مش موجود", "CONTACT_NOT_FOUND");
      if (c.type === "supplier") throw fail(422, "الحد ده للعملاء بس، والجهة دي مورد", "NOT_A_CUSTOMER");
      const before = storedLimitCents(c.l);
      const value = parsed.cents === null ? null : signedDecimal(parsed.cents);
      await tx.execute(sql`update contacts set credit_limit = ${value}::numeric, updated_at = now() where id = ${body.contactId}`);
      await writeAuditEvent({
        executor: tx, actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "credit.limit_set", resourceType: "contact", resourceId: body.contactId,
        beforeData: { creditLimit: dec(before) }, afterData: { creditLimit: value }, reason: body.reason, ipAddress: req.ip, userAgent: req.get("user-agent"),
      });
      return { contactId: body.contactId, limit: value };
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
