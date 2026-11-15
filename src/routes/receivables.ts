/** @format */
// كشف حساب العميل وأعمار الديون (51). قراءة بس، للإدارة العليا (finance) زي التحصيلات. ADR 0038.
import { Router } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { isIsoDate } from "../lib/ledgerCore";
import { todayCairo } from "../lib/operationsCapacityCore";
import { agingReport, customerStatement } from "../lib/receivables";
import { AGE_BUCKETS, signedDecimal } from "../lib/receivablesCore";

const router = Router();
const view = [requireAuth, requireRole(...PERMISSIONS.finance.view)];
const fail = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const isoDate = z.string().refine(isIsoDate, "تاريخ غير صحيح");
const dec = signedDecimal;

router.get("/receivables/aging", ...view, async (req, res, next) => {
  try {
    const q = z.object({ asOf: isoDate.optional() }).parse(req.query);
    const asOf = q.asOf ?? todayCairo(new Date());
    const r = await agingReport(db, asOf);
    res.json({
      asOf,
      rows: r.rows.map((x) => ({
        contactId: x.contactId, contactName: x.contactName, invoices: x.invoices, oldestDays: x.oldestDays, total: dec(x.totalCents),
        advance: dec(r.advances.get(x.contactId) ?? 0n),
        buckets: Object.fromEntries(AGE_BUCKETS.map((b) => [b, dec(x.buckets[b])])),
      })),
      totals: { ...Object.fromEntries(AGE_BUCKETS.map((b) => [b, dec(r.totals[b])])), total: dec(r.totalCents), advance: dec(r.advanceTotal) },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/receivables/statement", ...view, async (req, res, next) => {
  try {
    const q = z.object({ contactId: z.coerce.number().int().positive(), from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    if (q.from && q.to && q.from > q.to) throw fail(422, "تاريخ البداية بعد تاريخ النهاية", "BAD_RANGE");
    const head = (await db.execute(sql`select id, name, phone from contacts where id = ${q.contactId}`)) as { rows: Array<{ id: number; name: string; phone: string | null }> };
    const contact = head.rows[0];
    if (!contact) throw fail(404, "العميل مش موجود", "CONTACT_NOT_FOUND");
    const s = await customerStatement(db, q.contactId, q.from ?? null, q.to ?? null);
    res.json({
      contact: { id: Number(contact.id), name: contact.name, phone: contact.phone },
      from: q.from ?? null, to: q.to ?? null, generatedOn: todayCairo(new Date()),
      opening: dec(s.openingCents), closing: dec(s.closingCents), debit: dec(s.debitCents), credit: dec(s.creditCents),
      lines: s.lines.map((l) => ({ kind: l.kind, id: l.id, date: l.date, number: l.number, note: l.note, debit: dec(l.debitCents), credit: dec(l.creditCents), balance: dec(l.balanceCents) })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
