/** @format */
/**
 * Plan 07 — activation requests desk (staff side).
 * Prefix: /portal-admin/activation-requests. Confirm / reject stay on the
 * legacy PATCH /portal-activation-requests/:id/{confirm,reject} (they now write events too).
 */
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  contactsTable,
  portalActivationRequestEventsTable,
  portalActivationRequestsTable,
  portalCustomersTable,
  systemUsersTable,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { writeAuditEvent } from "../lib/governance";
import { domainError } from "../lib/portalTeam";
import { normalizePhone } from "../lib/identityNormalization";
import { issueActivationLink } from "../lib/portalActivation";
import { deliverActivation } from "../lib/activationDelivery";
import { resolveSetting } from "../lib/portalSettings";
import { normalizeArabicName } from "../lib/applicationMatching";
import { activationSla, rankContacts, type ContactLite } from "../lib/activationMatching";
import { addActivationEvent } from "../lib/activationEvents";

const router = Router();
const view = [requireAuth, requireRole(...PERMISSIONS.portalCustomers.view)];
const write = [requireAuth, requireRole(...PERMISSIONS.portalCustomers.write)];

const STATUSES = ["pending", "confirmed", "rejected", "closed"];
const BASE = "/portal-admin/activation-requests";

function id(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw domainError(400, "INVALID_ID", "المعرّف غير صحيح");
  return n;
}
const actorOf = (req: { user?: { userId: number; username: string } }) => ({
  actorUserId: req.user!.userId,
  actorLabel: `staff:${req.user!.username}`,
});

async function slaLimits() {
  const [warn, late] = await Promise.all([
    resolveSetting<number>("applications.sla.warn_hours", {}),
    resolveSetting<number>("applications.sla.late_hours", {}),
  ]);
  return { warnHours: warn, lateHours: Math.max(late, warn) };
}

async function reviewerNames(): Promise<Map<number, string>> {
  const rows = await db.select({ id: systemUsersTable.id, fullName: systemUsersTable.fullName }).from(systemUsersTable);
  return new Map(rows.map((r) => [r.id, r.fullName]));
}

type Row = typeof portalActivationRequestsTable.$inferSelect;

function present(r: Row, limits: { warnHours: number; lateHours: number }, names: Map<number, string>) {
  const sla = activationSla(r.createdAt, r.status, limits);
  return {
    id: r.id,
    companyNameEntered: r.companyNameEntered,
    phoneEntered: r.phoneEntered,
    status: r.status,
    matchedContactId: r.matchedContactId,
    matchedPortalCustomerId: r.matchedPortalCustomerId,
    rejectionReason: r.rejectionReason,
    closeReason: r.closeReason,
    internalNotes: r.internalNotes,
    assignedReviewerId: r.assignedReviewerId,
    assignedReviewerName: r.assignedReviewerId ? (names.get(r.assignedReviewerId) ?? null) : null,
    requestCount: r.requestCount,
    lastRequestedAt: r.lastRequestedAt,
    decidedAt: r.decidedAt,
    createdAt: r.createdAt,
    sla: sla.state,
    ageHours: Math.floor(sla.ageHours),
  };
}

router.get(`${BASE}/meta`, ...view, async (_req, res, next) => {
  try {
    const reviewers = await db
      .select({ id: systemUsersTable.id, fullName: systemUsersTable.fullName, role: systemUsersTable.role })
      .from(systemUsersTable)
      .where(and(eq(systemUsersTable.status, "active"), inArray(systemUsersTable.role, PERMISSIONS.portalCustomers.write as unknown as string[])))
      .orderBy(systemUsersTable.fullName);
    res.json({ reviewers, sla: await slaLimits() });
  } catch (e) {
    next(e);
  }
});

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(40).optional(), // pending | confirmed | rejected | closed | all
  reviewer: z.string().trim().max(20).optional(),
  age: z.enum(["warn", "late"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

router.get(BASE, ...view, async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    const limits = await slaLimits();
    const conds = [];
    const st = q.status || "pending";
    conds.push(inArray(portalActivationRequestsTable.status, st === "all" ? STATUSES : STATUSES.includes(st) ? [st] : ["pending"]));
    if (q.q) {
      const like = `%${q.q.replace(/[%_]/g, "")}%`;
      const phone = normalizePhone(q.q);
      conds.push(
        or(
          ilike(portalActivationRequestsTable.companyNameEntered, like),
          ilike(portalActivationRequestsTable.phoneEntered, like),
          phone ? eq(portalActivationRequestsTable.normalizedPhone, phone) : undefined,
        )!,
      );
    }
    if (q.reviewer === "me") conds.push(eq(portalActivationRequestsTable.assignedReviewerId, req.user!.userId));
    else if (q.reviewer === "none") conds.push(sql`${portalActivationRequestsTable.assignedReviewerId} IS NULL`);
    else if (q.reviewer && /^\d+$/.test(q.reviewer)) conds.push(eq(portalActivationRequestsTable.assignedReviewerId, Number(q.reviewer)));
    if (q.age) {
      const hours = q.age === "late" ? limits.lateHours : limits.warnHours;
      conds.push(sql`${portalActivationRequestsTable.createdAt} <= now() - (${hours} * interval '1 hour')`);
      conds.push(eq(portalActivationRequestsTable.status, "pending"));
    }
    const where = and(...conds);
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(portalActivationRequestsTable).where(where);
    const rows = await db
      .select()
      .from(portalActivationRequestsTable)
      .where(where)
      .orderBy(desc(portalActivationRequestsTable.lastRequestedAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const countRows = await db
      .select({ status: portalActivationRequestsTable.status, n: sql<number>`count(*)::int` })
      .from(portalActivationRequestsTable)
      .groupBy(portalActivationRequestsTable.status);
    const counts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const c of countRows) counts[c.status] = c.n;

    const contactIds = [...new Set(rows.map((r) => r.matchedContactId).filter((x): x is number => !!x))];
    const contacts = contactIds.length
      ? await db.select({ id: contactsTable.id, name: contactsTable.name, company: contactsTable.company, phone: contactsTable.phone }).from(contactsTable).where(inArray(contactsTable.id, contactIds))
      : [];
    const byId = new Map(contacts.map((c) => [c.id, c]));
    const names = await reviewerNames();
    const items = rows.map((r) => ({
      ...present(r, limits, names),
      matchedContact: r.matchedContactId ? (byId.get(r.matchedContactId) ?? null) : null,
    }));
    res.json({ items, total: n, page: q.page, pageSize: q.pageSize, counts });
  } catch (e) {
    next(e);
  }
});

/* manual search among existing customers */
router.get(`${BASE}/contacts/search`, ...view, async (req, res, next) => {
  try {
    const term = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    if (term.length < 2) {
      res.json({ items: [] });
      return;
    }
    const like = `%${term.replace(/[%_]/g, "")}%`;
    const digits = term.replace(/\D/g, "");
    const rows = await db
      .select({ id: contactsTable.id, name: contactsTable.name, company: contactsTable.company, phone: contactsTable.phone, email: contactsTable.email })
      .from(contactsTable)
      .where(
        and(
          inArray(contactsTable.type, ["customer", "both"]),
          or(
            ilike(contactsTable.name, like),
            ilike(contactsTable.company, like),
            ilike(contactsTable.phone, like),
            digits.length >= 5 ? sql`regexp_replace(coalesce(${contactsTable.phone}, ''), '\D', '', 'g') LIKE ${"%" + digits.slice(-9) + "%"}` : undefined,
          )!,
        ),
      )
      .orderBy(contactsTable.name)
      .limit(10);
    const linked = await linkedSet(rows.map((r) => r.id));
    res.json({ items: rows.map((r) => ({ ...r, alreadyLinked: linked.has(r.id) })) });
  } catch (e) {
    next(e);
  }
});

async function linkedSet(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const rows = await db.select({ contactId: portalCustomersTable.contactId }).from(portalCustomersTable).where(inArray(portalCustomersTable.contactId, ids));
  return new Set(rows.map((r) => r.contactId).filter((x): x is number => !!x));
}

router.get(`${BASE}/:id`, ...view, async (req, res, next) => {
  try {
    const rid = id(req.params.id);
    const [r] = await db.select().from(portalActivationRequestsTable).where(eq(portalActivationRequestsTable.id, rid)).limit(1);
    if (!r) throw domainError(404, "ACTIVATION_REQUEST_NOT_FOUND", "طلب التفعيل غير موجود");
    const limits = await slaLimits();
    const names = await reviewerNames();

    // مرشّحين: نفس آخر 9 أرقام من التليفون، أو أول كلمتين من اسم الشركة.
    const tail = normalizePhone(r.phoneEntered).replace(/\D/g, "").slice(-9);
    const tokens = normalizeArabicName(r.companyNameEntered).split(" ").filter((w) => w.length > 2).slice(0, 2);
    const likeConds = tokens.map((w) => ilike(contactsTable.company, `%${w.replace(/[%_]/g, "")}%`));
    const pool = await db
      .select({ id: contactsTable.id, name: contactsTable.name, company: contactsTable.company, phone: contactsTable.phone, email: contactsTable.email })
      .from(contactsTable)
      .where(
        and(
          inArray(contactsTable.type, ["customer", "both"]),
          or(
            tail.length >= 7 ? sql`regexp_replace(coalesce(${contactsTable.phone}, ''), '\D', '', 'g') LIKE ${"%" + tail + "%"}` : undefined,
            ...likeConds,
          )!,
        ),
      )
      .limit(80);
    const ranked = rankContacts(
      { companyName: r.companyNameEntered, phone: r.phoneEntered },
      pool as ContactLite[],
      await linkedSet(pool.map((p) => p.id)),
    );

    const phoneNorm = normalizePhone(r.phoneEntered);
    const [account] = phoneNorm
      ? await db
          .select({ id: portalCustomersTable.id, companyName: portalCustomersTable.companyName, isActive: portalCustomersTable.isActive })
          .from(portalCustomersTable)
          .where(or(eq(portalCustomersTable.normalizedPhone, phoneNorm), eq(portalCustomersTable.phone, r.phoneEntered)))
          .limit(1)
      : [];
    const matchedAccountId = r.matchedPortalCustomerId ?? account?.id ?? null;

    const events = await db
      .select()
      .from(portalActivationRequestEventsTable)
      .where(eq(portalActivationRequestEventsTable.requestId, rid))
      .orderBy(desc(portalActivationRequestEventsTable.id));

    res.json({
      request: present(r, limits, names),
      candidates: ranked,
      existingAccount: account ? { id: account.id, companyName: account.companyName, isActive: account.isActive } : null,
      matchedAccountId,
      events,
    });
  } catch (e) {
    next(e);
  }
});

const patchBody = z
  .object({
    assignedReviewerId: z.number().int().positive().nullable().optional(),
    internalNotes: z.string().max(4000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "مفيش حاجة تتعدّل");

router.patch(`${BASE}/:id`, ...write, async (req, res, next) => {
  try {
    const rid = id(req.params.id);
    const body = patchBody.parse(req.body);
    const a = actorOf(req);
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(portalActivationRequestsTable).where(eq(portalActivationRequestsTable.id, rid)).for("update");
      if (!r) throw domainError(404, "ACTIVATION_REQUEST_NOT_FOUND", "طلب التفعيل غير موجود");
      const set: Partial<Row> = {};
      if (body.assignedReviewerId !== undefined && body.assignedReviewerId !== r.assignedReviewerId) {
        set.assignedReviewerId = body.assignedReviewerId;
        const names = await reviewerNames();
        await addActivationEvent(tx, rid, { kind: "assigned", ...a, note: body.assignedReviewerId ? (names.get(body.assignedReviewerId) ?? null) : null });
      }
      if (body.internalNotes !== undefined && (body.internalNotes ?? null) !== (r.internalNotes ?? null)) {
        set.internalNotes = body.internalNotes?.trim() ? body.internalNotes.trim() : null;
        await addActivationEvent(tx, rid, { kind: "note", ...a });
      }
      if (Object.keys(set).length) await tx.update(portalActivationRequestsTable).set(set).where(eq(portalActivationRequestsTable.id, rid));
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

const closeBody = z.object({ reason: z.string().trim().min(2, "السبب مطلوب").max(1000) });

router.post(`${BASE}/:id/close`, ...write, async (req, res, next) => {
  try {
    const rid = id(req.params.id);
    const { reason } = closeBody.parse(req.body);
    const a = actorOf(req);
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(portalActivationRequestsTable).where(eq(portalActivationRequestsTable.id, rid)).for("update");
      if (!r) throw domainError(404, "ACTIVATION_REQUEST_NOT_FOUND", "طلب التفعيل غير موجود");
      if (r.status !== "pending") throw domainError(409, "ACTIVATION_REQUEST_ALREADY_DECIDED", "تم اتخاذ قرار في طلب التفعيل ده بالفعل");
      const [u] = await tx
        .update(portalActivationRequestsTable)
        .set({ status: "closed", closeReason: reason, decidedByUserId: a.actorUserId, decidedAt: new Date() })
        .where(eq(portalActivationRequestsTable.id, rid))
        .returning();
      await addActivationEvent(tx, rid, { kind: "closed", ...a, note: reason });
      await writeAuditEvent({
        executor: tx,
        actorUserId: a.actorUserId,
        actorName: req.user!.username,
        actionKey: "portal.activation_request.closed",
        resourceType: "portal_activation_request",
        resourceId: rid,
        beforeData: r,
        afterData: u,
        decision: "closed",
        reason,
      });
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

const resendBody = z.object({ ttlMinutes: z.coerce.number().int().optional() });

router.post(`${BASE}/:id/resend`, ...write, async (req, res, next) => {
  try {
    const rid = id(req.params.id);
    const { ttlMinutes } = resendBody.parse(req.body ?? {});
    const a = actorOf(req);
    const issued = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(portalActivationRequestsTable).where(eq(portalActivationRequestsTable.id, rid)).for("update");
      if (!r) throw domainError(404, "ACTIVATION_REQUEST_NOT_FOUND", "طلب التفعيل غير موجود");
      if (r.status !== "confirmed" || !r.matchedPortalCustomerId) {
        throw domainError(409, "ACTIVATION_NOT_CONFIRMED", "الطلب ده لسه ماتأكدش");
      }
      const [c] = await tx.select().from(portalCustomersTable).where(eq(portalCustomersTable.id, r.matchedPortalCustomerId)).limit(1);
      if (!c) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "حساب الشركة مش موجود");
      const link = await issueActivationLink(tx, req, { portalCustomerId: c.id, ttlMinutes, staffId: a.actorUserId });
      await addActivationEvent(tx, rid, { kind: "resent", ...a });
      await writeAuditEvent({
        executor: tx,
        actorUserId: a.actorUserId,
        actorName: req.user!.username,
        actionKey: "portal.activation_request.resent",
        resourceType: "portal_activation_request",
        resourceId: rid,
        afterData: { portalCustomerId: c.id, expiresAt: link.expiresAt },
        decision: "resent",
      });
      return { link, customer: c };
    });
    const activation = await deliverActivation(issued.customer, issued.link, { companyId: issued.customer.id, staffId: a.actorUserId });
    res.json({ activation });
  } catch (e) {
    next(e);
  }
});

export default router;
