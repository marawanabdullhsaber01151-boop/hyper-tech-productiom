/** @format */
/**
 * Plan 06 — join applications review desk (staff side).
 * Prefix: /portal-admin/applications. The legacy /portal-applications* routes
 * keep working and keep `stage` in step through reviewApplication().
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  contactsTable,
  portalApplicationEventsTable,
  portalApplicationsTable,
  portalCustomersTable,
  portalMembersTable,
  portalUsersTable,
  systemUsersTable,
} from "../db/schema";
import { CONTACT_SEGMENTS, EGYPT_GOVERNORATES } from "../db/schema/contacts";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { writeAuditEvent } from "../lib/governance";
import { domainError, generateTempPassword } from "../lib/portalTeam";
import { normalizeEmail, normalizePhone } from "../lib/identityNormalization";
import { provisionCompanyIdentity } from "../lib/portalIdentityProvisioning";
import { buildWhatsAppLink, clampActivationTtlMinutes, issueActivationLink } from "../lib/portalActivation";
import { deliverActivation } from "../lib/activationDelivery";
import { createMemberAccount } from "../lib/portalMemberCreate";
import { resolveSetting } from "../lib/portalSettings";
import { changeSetting } from "../lib/portalSettingsHistory";
import { sendPortalSms } from "../lib/portalMessaging";
import {
  completenessScore,
  matchRecord,
  missingFields,
  slaState,
  type MatchResult,
} from "../lib/applicationMatching";
import { addApplicationEvent, stagePatch } from "../lib/applicationEvents";
import { csvCell } from "../lib/csv";

const router = Router();
const view = [requireAuth, requireRole(...PERMISSIONS.portalCustomers.view)];
const write = [requireAuth, requireRole(...PERMISSIONS.portalCustomers.write)];

const OPEN_STAGES = ["new", "needs_info", "ready"];
const ALL_STAGES = ["new", "needs_info", "ready", "approved", "rejected", "duplicate_auto_closed"];

function id(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw domainError(400, "INVALID_ID", "المعرّف غير صحيح");
  return n;
}
const actorOf = (req: Request) => ({ actorUserId: req.user!.userId, actorLabel: `staff:${req.user!.username}` });

async function slaLimits() {
  const [warn, late] = await Promise.all([
    resolveSetting<number>("applications.sla.warn_hours", {}),
    resolveSetting<number>("applications.sla.late_hours", {}),
  ]);
  return { warnHours: warn, lateHours: Math.max(late, warn) };
}

type AppRow = typeof portalApplicationsTable.$inferSelect;

function present(a: AppRow, limits: { warnHours: number; lateHours: number }, names: Map<number, string>) {
  const sla = slaState(a.createdAt, a.stage, limits);
  return {
    id: a.id,
    referenceCode: a.referenceCode,
    fullName: a.fullName,
    companyName: a.companyName,
    phone: a.phone,
    email: a.email,
    address: a.address,
    city: a.city,
    commercialRegisterNo: a.commercialRegisterNo,
    taxId: a.taxId,
    expectedMonthlyVolume: a.expectedMonthlyVolume,
    notes: a.notes,
    stage: a.stage,
    status: a.status,
    reviewerNote: a.reviewerNote,
    internalNotes: a.internalNotes,
    completeness: a.completeness,
    missing: missingFields(a),
    assignedReviewerId: a.assignedReviewerId,
    assignedReviewerName: a.assignedReviewerId ? names.get(a.assignedReviewerId) ?? null : null,
    decision: a.decision,
    approvedCompanyId: a.approvedCompanyId,
    customerResponseAt: a.customerResponseAt,
    sla: sla.state,
    ageHours: Math.floor(sla.ageHours),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

async function reviewerNames(): Promise<Map<number, string>> {
  const rows = await db.select({ id: systemUsersTable.id, fullName: systemUsersTable.fullName }).from(systemUsersTable);
  return new Map(rows.map((r) => [r.id, r.fullName]));
}

/* ------------------------------------------------------------------ */
/* Matches                                                             */
/* ------------------------------------------------------------------ */
export async function findApplicationMatches(app: AppRow) {
  const phone = normalizePhone(app.phone);
  const email = normalizeEmail(app.email);

  const companies = await db
    .select({
      id: portalCustomersTable.id,
      companyName: portalCustomersTable.companyName,
      phone: portalCustomersTable.phone,
      email: portalCustomersTable.email,
      contactId: portalCustomersTable.contactId,
      isActive: portalCustomersTable.isActive,
    })
    .from(portalCustomersTable)
    .limit(5000);
  const contacts = await db
    .select({
      id: contactsTable.id,
      name: contactsTable.name,
      company: contactsTable.company,
      phone: contactsTable.phone,
      email: contactsTable.email,
      city: contactsTable.city,
    })
    .from(contactsTable)
    .where(eq(contactsTable.type, "customer"))
    .limit(5000);
  const linkedContactIds = new Set(companies.map((c) => c.contactId).filter((x): x is number => x != null));
  const others = await db
    .select()
    .from(portalApplicationsTable)
    .where(and(sql`${portalApplicationsTable.id} <> ${app.id}`, inArray(portalApplicationsTable.stage, OPEN_STAGES)))
    .limit(2000);

  const input = { phone: app.phone, email: app.email, companyName: app.companyName };
  const rank = (m: MatchResult) => m.score;

  const companyMatches = companies
    .map((c) => ({ c, m: matchRecord(input, { phone: c.phone, email: c.email, name: c.companyName }) }))
    .filter((x): x is { c: (typeof companies)[number]; m: MatchResult } => !!x.m)
    .sort((a, b) => rank(b.m) - rank(a.m))
    .slice(0, 5)
    .map(({ c, m }) => ({ kind: "company" as const, id: c.id, name: c.companyName, phone: c.phone, email: c.email, active: c.isActive, ...m }));

  const contactMatches = contacts
    .map((c) => ({ c, m: matchRecord(input, { phone: c.phone, email: c.email, name: c.company || c.name }) }))
    .filter((x): x is { c: (typeof contacts)[number]; m: MatchResult } => !!x.m)
    .sort((a, b) => rank(b.m) - rank(a.m))
    .slice(0, 5)
    .map(({ c, m }) => ({ kind: "contact" as const, id: c.id, name: c.company || c.name, contactName: c.name, phone: c.phone, email: c.email, city: c.city, alreadyLinked: linkedContactIds.has(c.id), ...m }));

  const appMatches = others
    .map((o) => ({ o, m: matchRecord(input, { phone: o.phone, email: o.email, name: o.companyName }) }))
    .filter((x): x is { o: AppRow; m: MatchResult } => !!x.m)
    .sort((a, b) => rank(b.m) - rank(a.m))
    .slice(0, 5)
    .map(({ o, m }) => ({ kind: "application" as const, id: o.id, referenceCode: o.referenceCode, name: o.companyName, phone: o.phone, stage: o.stage, ...m }));

  const userPhoneTaken = phone
    ? (await db.select({ id: portalUsersTable.id }).from(portalUsersTable).where(eq(portalUsersTable.normalizedPhone, phone)).limit(1)).length > 0
    : false;
  const userEmailTaken = email
    ? (await db.select({ id: portalUsersTable.id }).from(portalUsersTable).where(eq(portalUsersTable.normalizedEmail, email)).limit(1)).length > 0
    : false;

  return { companies: companyMatches, contacts: contactMatches, applications: appMatches, userPhoneTaken, userEmailTaken };
}

/** Cheap duplicate flag for list rows (phone/email only; names are in the drawer). */
async function duplicateFlags(rows: AppRow[]) {
  const phones = [...new Set(rows.map((r) => normalizePhone(r.phone)).filter(Boolean))];
  if (!phones.length) return new Set<number>();
  const taken = await db
    .select({ p: portalCustomersTable.normalizedPhone })
    .from(portalCustomersTable)
    .where(inArray(portalCustomersTable.normalizedPhone, phones));
  const contactTaken = await db
    .select({ p: contactsTable.phone })
    .from(contactsTable)
    .where(inArray(contactsTable.phone, rows.map((r) => r.phone)));
  const set = new Set(taken.map((t) => t.p));
  const cset = new Set(contactTaken.map((t) => normalizePhone(t.p)));
  return new Set(rows.filter((r) => set.has(normalizePhone(r.phone)) || cset.has(normalizePhone(r.phone)) || r.duplicateCompanyId || r.duplicateContactId).map((r) => r.id));
}

/* ------------------------------------------------------------------ */
/* Meta                                                                */
/* ------------------------------------------------------------------ */
router.get("/portal-admin/applications/meta", ...view, async (_req, res, next) => {
  try {
    const reviewers = await db
      .select({ id: systemUsersTable.id, fullName: systemUsersTable.fullName, role: systemUsersTable.role })
      .from(systemUsersTable)
      .where(and(eq(systemUsersTable.status, "active"), inArray(systemUsersTable.role, PERMISSIONS.portalCustomers.write as unknown as string[])))
      .orderBy(systemUsersTable.fullName);
    const [rejectTemplates, infoTemplates, limits, joinMode, chatMode, maxMembers, defaultRole] = await Promise.all([
      resolveSetting<string[]>("applications.reject_templates", {}),
      resolveSetting<string[]>("applications.info_templates", {}),
      slaLimits(),
      resolveSetting<string>("join.mode", {}),
      resolveSetting<string>("chat.mode", {}),
      resolveSetting<number>("team.max_members", {}),
      resolveSetting<string>("join.default_role", {}),
    ]);
    res.json({
      reviewers,
      stages: ALL_STAGES,
      segments: CONTACT_SEGMENTS,
      governorates: EGYPT_GOVERNORATES,
      rejectTemplates,
      infoTemplates,
      sla: limits,
      defaults: { joinMode, chatMode, maxMembers, defaultRole, minOrderQty: 1 },
    });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  stage: z.string().trim().max(200).optional(), // csv, or "open" / "all"
  reviewer: z.string().trim().max(20).optional(), // "me" | "none" | id
  age: z.enum(["warn", "late"]).optional(),
  duplicate: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

async function buildFilter(req: Request, q: z.infer<typeof listQuery>, limits: { warnHours: number; lateHours: number }) {
  const conds = [];
  const stageParam = q.stage || "open";
  const stages =
    stageParam === "all" ? ALL_STAGES
    : stageParam === "open" ? OPEN_STAGES
    : stageParam.split(",").filter((s) => ALL_STAGES.includes(s));
  conds.push(inArray(portalApplicationsTable.stage, stages.length ? stages : OPEN_STAGES));
  if (q.q) {
    const like = `%${q.q.replace(/[%_]/g, "")}%`;
    const digits = normalizePhone(q.q);
    conds.push(
      or(
        ilike(portalApplicationsTable.fullName, like),
        ilike(portalApplicationsTable.companyName, like),
        ilike(portalApplicationsTable.referenceCode, like),
        ilike(portalApplicationsTable.phone, like),
        digits ? eq(portalApplicationsTable.normalizedPhone, digits) : undefined,
      )!,
    );
  }
  if (q.reviewer === "me") conds.push(eq(portalApplicationsTable.assignedReviewerId, req.user!.userId));
  else if (q.reviewer === "none") conds.push(sql`${portalApplicationsTable.assignedReviewerId} IS NULL`);
  else if (q.reviewer && /^\d+$/.test(q.reviewer)) conds.push(eq(portalApplicationsTable.assignedReviewerId, Number(q.reviewer)));
  if (q.age) {
    const hours = q.age === "late" ? limits.lateHours : limits.warnHours;
    conds.push(sql`${portalApplicationsTable.createdAt} <= now() - (${hours} * interval '1 hour')`);
    conds.push(inArray(portalApplicationsTable.stage, ["new", "ready"]));
  }
  return and(...conds);
}

router.get("/portal-admin/applications", ...view, async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    const limits = await slaLimits();
    const where = await buildFilter(req, q, limits);
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(portalApplicationsTable).where(where);
    const rows = await db
      .select()
      .from(portalApplicationsTable)
      .where(where)
      .orderBy(desc(portalApplicationsTable.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const countRows = await db
      .select({ stage: portalApplicationsTable.stage, n: sql<number>`count(*)::int` })
      .from(portalApplicationsTable)
      .groupBy(portalApplicationsTable.stage);
    const counts: Record<string, number> = Object.fromEntries(ALL_STAGES.map((s) => [s, 0]));
    for (const c of countRows) counts[c.stage] = c.n;
    const names = await reviewerNames();
    const dups = await duplicateFlags(rows);
    let items = rows.map((r) => ({ ...present(r, limits, names), hasDuplicate: dups.has(r.id) }));
    if (q.duplicate) items = items.filter((i) => i.hasDuplicate);
    res.json({ items, total: n, page: q.page, pageSize: q.pageSize, counts });
  } catch (e) {
    next(e);
  }
});

router.get("/portal-admin/applications/export.csv", ...view, async (req, res, next) => {
  try {
    const q = listQuery.parse({ ...req.query, page: 1, pageSize: 200 });
    const limits = await slaLimits();
    const where = await buildFilter(req, q, limits);
    const rows = await db.select().from(portalApplicationsTable).where(where).orderBy(desc(portalApplicationsTable.createdAt)).limit(5000);
    const names = await reviewerNames();
    const head = ["رقم الطلب", "الاسم", "الشركة", "الهاتف", "الإيميل", "المحافظة", "المرحلة", "اكتمال البيانات %", "المراجع", "تاريخ التقديم"];
    const lines = [head.map(csvCell).join(",")];
    for (const r of rows) {
      lines.push(
        [r.referenceCode, r.fullName, r.companyName, r.phone, r.email, r.city, r.stage, r.completeness, r.assignedReviewerId ? names.get(r.assignedReviewerId) : "", r.createdAt.toISOString()]
          .map(csvCell)
          .join(","),
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="applications.csv"');
    res.send("﻿" + lines.join("\r\n"));
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */
router.get("/portal-admin/applications/:id", ...view, async (req, res, next) => {
  try {
    const appId = id(req.params.id);
    const [app] = await db.select().from(portalApplicationsTable).where(eq(portalApplicationsTable.id, appId)).limit(1);
    if (!app) throw domainError(404, "APPLICATION_NOT_FOUND", "طلب الانضمام غير موجود");
    const [limits, names, matches, events] = await Promise.all([
      slaLimits(),
      reviewerNames(),
      findApplicationMatches(app),
      db.select().from(portalApplicationEventsTable).where(eq(portalApplicationEventsTable.applicationId, appId)).orderBy(desc(portalApplicationEventsTable.id)).limit(200),
    ]);
    res.json({ application: present(app, limits, names), matches, events });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* Edit / assign / notes                                               */
/* ------------------------------------------------------------------ */
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const patchSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  companyName: z.string().trim().min(2).max(160).optional(),
  phone: z.string().trim().min(8).max(30).optional(),
  email: z.string().trim().email().nullable().optional().or(z.literal("").transform(() => null)),
  address: optText(500),
  city: optText(80),
  commercialRegisterNo: optText(120),
  taxId: optText(120),
  expectedMonthlyVolume: optText(120),
  internalNotes: optText(2000),
  assignedReviewerId: z.number().int().positive().nullable().optional(),
});

router.patch("/portal-admin/applications/:id", ...write, async (req, res, next) => {
  try {
    const appId = id(req.params.id);
    const body = patchSchema.parse(req.body ?? {});
    const result = await db.transaction(async (tx) => {
      const [app] = await tx.select().from(portalApplicationsTable).where(eq(portalApplicationsTable.id, appId)).for("update");
      if (!app) throw domainError(404, "APPLICATION_NOT_FOUND", "طلب الانضمام غير موجود");
      const open = OPEN_STAGES.includes(app.stage);
      const touchesData = ["fullName", "companyName", "phone", "email", "address", "city", "commercialRegisterNo", "taxId", "expectedMonthlyVolume"].some((k) => (body as Record<string, unknown>)[k] !== undefined);
      if (touchesData && !open) throw domainError(409, "APPLICATION_ALREADY_DECIDED", "الطلب اتقفل ومينفعش نعدّل بياناته");

      const set: Record<string, unknown> = { updatedAt: new Date() };
      const changed: string[] = [];
      for (const k of ["fullName", "companyName", "phone", "address", "city", "commercialRegisterNo", "taxId", "expectedMonthlyVolume", "internalNotes"] as const) {
        const v = body[k];
        if (v === undefined) continue;
        const next = v === null || v === "" ? null : v;
        if ((app[k] ?? null) !== next) {
          set[k] = k === "address" ? next ?? "" : next;
          changed.push(k);
        }
      }
      if (body.email !== undefined && (app.email ?? null) !== (body.email || null)) {
        set.email = body.email || null;
        changed.push("email");
      }
      if (set.phone) set.normalizedPhone = normalizePhone(String(set.phone));
      if (set.companyName) set.normalizedCompanyName = String(set.companyName).toLowerCase();
      if (set.email !== undefined) set.normalizedEmail = set.email ? normalizeEmail(String(set.email)) : null;
      if (body.assignedReviewerId !== undefined && body.assignedReviewerId !== app.assignedReviewerId) {
        if (body.assignedReviewerId) {
          const [u] = await tx.select({ id: systemUsersTable.id }).from(systemUsersTable).where(eq(systemUsersTable.id, body.assignedReviewerId)).limit(1);
          if (!u) throw domainError(400, "INVALID_REVIEWER", "الموظف ده مش موجود");
        }
        set.assignedReviewerId = body.assignedReviewerId;
        changed.push("assignedReviewerId");
      }
      if (!changed.length) return app;
      const merged = { ...app, ...set } as AppRow;
      set.completeness = completenessScore(merged);
      const [updated] = await tx.update(portalApplicationsTable).set(set).where(eq(portalApplicationsTable.id, appId)).returning();
      const kind = changed.length === 1 && changed[0] === "assignedReviewerId" ? "assigned" : changed.length === 1 && changed[0] === "internalNotes" ? "note" : "edited";
      await addApplicationEvent(tx, appId, { kind, ...actorOf(req), note: kind === "note" ? body.internalNotes ?? null : null, data: { fields: changed } });
      await writeAuditEvent({
        executor: tx,
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: "portal.application.update",
        resourceType: "portal_application",
        resourceId: appId,
        beforeData: app,
        afterData: updated,
        reason: "تعديل بيانات طلب انضمام",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      return updated!;
    });
    const [limits, names] = await Promise.all([slaLimits(), reviewerNames()]);
    res.json({ message: "اتحفظ", application: present(result, limits, names) });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* Request info / reject                                               */
/* ------------------------------------------------------------------ */
const reasonSchema = z.object({ reason: z.string().trim().min(3, "اكتب الرسالة (3 حروف على الأقل)").max(1000) });

async function closeOrAsk(req: Request, appId: number, target: "needs_info" | "rejected", reason: string) {
  return db.transaction(async (tx) => {
    const [app] = await tx.select().from(portalApplicationsTable).where(eq(portalApplicationsTable.id, appId)).for("update");
    if (!app) throw domainError(404, "APPLICATION_NOT_FOUND", "طلب الانضمام غير موجود");
    if (!OPEN_STAGES.includes(app.stage)) throw domainError(409, "APPLICATION_ALREADY_DECIDED", "تم اتخاذ قرار في الطلب ده بالفعل");
    const now = new Date();
    const [updated] = await tx
      .update(portalApplicationsTable)
      .set({ ...stagePatch(target), reviewerNote: reason, reviewedByUserId: req.user!.userId, reviewedAt: now, decision: target === "rejected" ? "rejected" : app.decision })
      .where(eq(portalApplicationsTable.id, appId))
      .returning();
    await addApplicationEvent(tx, appId, { kind: target === "rejected" ? "rejected" : "info_requested", stageFrom: app.stage, stageTo: target, ...actorOf(req), note: reason });
    await writeAuditEvent({
      executor: tx,
      actorUserId: req.user!.userId,
      actorName: req.user!.username,
      actionKey: `portal.application.${target === "rejected" ? "rejected" : "needs_info"}`,
      resourceType: "portal_application",
      resourceId: appId,
      beforeData: app,
      afterData: updated,
      decision: target,
      reason,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    return updated!;
  });
}

router.post("/portal-admin/applications/:id/request-info", ...write, async (req, res, next) => {
  try {
    const { reason } = reasonSchema.parse(req.body ?? {});
    const app = await closeOrAsk(req, id(req.params.id), "needs_info", reason);
    const sms = await sendPortalSms({
      phone: app.phone,
      message: `Hyper-Tech: فريق المبيعات محتاج معلومات إضافية لطلبك رقم ${app.referenceCode}. ادخل صفحة متابعة الطلب وكمّل البيانات.`,
    }).catch(() => ({ delivered: false }));
    const wa = buildWhatsAppLink(app.phone, `أهلاً ${app.fullName}، بخصوص طلب انضمامك رقم ${app.referenceCode}: ${reason}\nمن فضلك ادخل صفحة متابعة الطلب وكمّل البيانات.`);
    res.json({ message: "بعتنا طلب المعلومات للعميل", whatsappUrl: wa, messaging: { delivered: !!sms.delivered } });
  } catch (e) {
    next(e);
  }
});

router.post("/portal-admin/applications/:id/reject", ...write, async (req, res, next) => {
  try {
    const { reason } = reasonSchema.parse(req.body ?? {});
    await closeOrAsk(req, id(req.params.id), "rejected", reason);
    res.json({ message: "اترفض الطلب واتسجّل السبب" });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* Approve (3 decisions)                                               */
/* ------------------------------------------------------------------ */
const setupSchema = z
  .object({
    maxMembers: z.number().int().min(1).max(1000).optional(),
    joinMode: z.enum(["approval", "auto", "disabled"]).optional(),
    chatMode: z.enum(["shared", "per_member", "per_member_monitored"]).optional(),
    defaultRole: z.string().trim().min(1).max(60).optional(),
    assignedSalesUserId: z.number().int().positive().nullable().optional(),
    segment: z.enum(CONTACT_SEGMENTS as unknown as [string, ...string[]]).optional(),
    minOrderQty: z.number().int().min(1).max(100000).optional(),
  })
  .default({});

const approveSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("new_company"), setup: setupSchema, ttlMinutes: z.number().int().optional() }),
  z.object({ decision: z.literal("join_company"), companyId: z.number().int().positive(), roleKey: z.string().trim().min(1).max(60).optional(), setup: setupSchema }),
  z.object({ decision: z.literal("link_contact"), contactId: z.number().int().positive(), setup: setupSchema, ttlMinutes: z.number().int().optional() }),
]);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function applySetup(tx: Tx, companyId: number, setup: z.infer<typeof setupSchema>, by: string) {
  const pairs: Array<[string, unknown | undefined]> = [
    ["team.max_members", setup.maxMembers],
    ["join.mode", setup.joinMode],
    ["chat.mode", setup.chatMode],
    ["join.default_role", setup.defaultRole],
  ];
  const applied: Record<string, unknown> = {};
  for (const [key, value] of pairs) {
    if (value === undefined) continue;
    const globalValue = await resolveSetting(key, {}, tx as never);
    if (JSON.stringify(globalValue) === JSON.stringify(value)) continue;
    await changeSetting(tx as never, { scope: "company", scopeId: companyId, key, value, by });
    applied[key] = value;
  }
  const patch: Record<string, unknown> = {};
  if (setup.assignedSalesUserId !== undefined) patch.assignedSalesUserId = setup.assignedSalesUserId;
  if (setup.minOrderQty !== undefined) patch.minimumOrderQuantity = setup.minOrderQty;
  if (Object.keys(patch).length) {
    await tx.update(portalCustomersTable).set(patch).where(eq(portalCustomersTable.id, companyId));
    Object.assign(applied, patch);
  }
  return applied;
}

async function assertContactsFree(tx: Tx, app: AppRow) {
  const phone = normalizePhone(app.phone);
  const [samePhone] = await tx
    .select({ id: portalCustomersTable.id })
    .from(portalCustomersTable)
    .where(or(eq(portalCustomersTable.phone, app.phone), eq(portalCustomersTable.normalizedPhone, phone)))
    .limit(1);
  const [userPhone] = await tx.select({ id: portalUsersTable.id }).from(portalUsersTable).where(eq(portalUsersTable.normalizedPhone, phone)).limit(1);
  if (samePhone || userPhone) throw domainError(409, "PORTAL_ACCOUNT_EXISTS", "رقم الهاتف ده مرتبط بحساب بوابة بالفعل");
  if (app.email) {
    const e = normalizeEmail(app.email);
    const [sameEmail] = await tx.select({ id: portalCustomersTable.id }).from(portalCustomersTable).where(eq(portalCustomersTable.normalizedEmail, e)).limit(1);
    const [userEmail] = await tx.select({ id: portalUsersTable.id }).from(portalUsersTable).where(eq(portalUsersTable.normalizedEmail, e)).limit(1);
    if (sameEmail || userEmail) throw domainError(409, "PORTAL_ACCOUNT_EXISTS", "البريد الإلكتروني ده مرتبط بحساب بوابة بالفعل");
  }
}

function contactNotes(a: AppRow): string {
  const lines = [`طلب انضمام ${a.referenceCode}`];
  if (a.commercialRegisterNo) lines.push(`السجل التجاري: ${a.commercialRegisterNo}`);
  if (a.taxId) lines.push(`الرقم الضريبي: ${a.taxId}`);
  if (a.expectedMonthlyVolume) lines.push(`حجم التعامل المتوقع: ${a.expectedMonthlyVolume}`);
  if (a.notes) lines.push(`ملاحظات العميل: ${a.notes}`);
  return lines.join("\n");
}

router.post("/portal-admin/applications/:id/approve", ...write, async (req, res, next) => {
  try {
    const appId = id(req.params.id);
    const body = approveSchema.parse(req.body ?? {});
    const by = `staff:${req.user!.userId}`;

    const result = await db.transaction(async (tx) => {
      const [app] = await tx.select().from(portalApplicationsTable).where(eq(portalApplicationsTable.id, appId)).for("update");
      if (!app) throw domainError(404, "APPLICATION_NOT_FOUND", "طلب الانضمام غير موجود");
      if (!OPEN_STAGES.includes(app.stage)) throw domainError(409, "APPLICATION_ALREADY_DECIDED", "تم اتخاذ قرار في الطلب ده بالفعل");

      let companyId: number;
      let out: Record<string, unknown> = {};
      let issued: Awaited<ReturnType<typeof issueActivationLink>> | null = null;
      let customerForDelivery: { fullName: string; phone: string } | null = null;

      if (body.decision === "join_company") {
        const [company] = await tx.select().from(portalCustomersTable).where(eq(portalCustomersTable.id, body.companyId)).for("update");
        if (!company) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الشركة مش موجودة");
        companyId = company.id;
        const roleKey = body.roleKey ?? (await resolveSetting<string>("join.default_role", { companyId }, tx as never));
        const created = await createMemberAccount(tx, {
          companyId,
          body: { fullName: app.fullName, phone: app.phone, email: app.email, roleKey },
          joinedVia: "admin_created",
        });
        const message = `أهلاً ${app.fullName}، اتضفت لحساب ${company.companyName} في Hyper-Tech.\nرقمك: ${app.phone}\nكلمة السر المؤقتة: ${created.tempPassword}\nهتغيّرها أول ما تدخل.`;
        out = { member: { id: created.memberId, roleKey: created.roleKey }, tempPassword: created.tempPassword, whatsappUrl: buildWhatsAppLink(app.phone, message), message };
      } else {
        await assertContactsFree(tx, app);
        let contactId: number;
        if (body.decision === "link_contact") {
          const [contact] = await tx.select().from(contactsTable).where(eq(contactsTable.id, body.contactId)).limit(1);
          if (!contact) throw domainError(404, "CONTACT_NOT_FOUND", "جهة الاتصال مش موجودة");
          const [linked] = await tx.select({ id: portalCustomersTable.id }).from(portalCustomersTable).where(eq(portalCustomersTable.contactId, contact.id)).limit(1);
          if (linked) throw domainError(409, "CONTACT_ALREADY_LINKED", "جهة الاتصال دي مربوطة بحساب بوابة تاني");
          contactId = contact.id;
        } else {
          const [contact] = await tx
            .insert(contactsTable)
            .values({ type: "customer", name: app.fullName, company: app.companyName, phone: app.phone, email: app.email, address: app.address, city: app.city, notes: contactNotes(app) })
            .returning({ id: contactsTable.id });
          contactId = contact!.id;
        }
        const [customer] = await tx
          .insert(portalCustomersTable)
          .values({
            phone: app.phone,
            normalizedPhone: normalizePhone(app.phone),
            email: app.email,
            normalizedEmail: app.email ? normalizeEmail(app.email) : null,
            passwordHash: await bcrypt.hash(randomBytes(32).toString("base64url"), 12),
            fullName: app.fullName,
            companyName: app.companyName,
            city: app.city,
            contactId,
            minimumOrderQuantity: 1,
          })
          .returning({ id: portalCustomersTable.id, fullName: portalCustomersTable.fullName, phone: portalCustomersTable.phone, companyName: portalCustomersTable.companyName });
        companyId = customer!.id;
        await provisionCompanyIdentity(tx, companyId, { joinedVia: "admin_created" });
        const ttl = clampActivationTtlMinutes(body.ttlMinutes ?? (await resolveSetting<number>("auth.activation.ttl_minutes", {}, tx as never)));
        issued = await issueActivationLink(tx, req, { portalCustomerId: companyId, ttlMinutes: ttl });
        customerForDelivery = { fullName: customer!.fullName, phone: customer!.phone };
        out = { activationExpiresAt: issued.expiresAt };
      }

      const applied = await applySetup(tx, companyId, body.setup, by);
      if (body.setup.segment && body.decision !== "join_company") {
        const [c] = await tx.select({ contactId: portalCustomersTable.contactId }).from(portalCustomersTable).where(eq(portalCustomersTable.id, companyId)).limit(1);
        if (c?.contactId) await tx.update(contactsTable).set({ segment: body.setup.segment }).where(eq(contactsTable.id, c.contactId));
      }

      const now = new Date();
      const [updated] = await tx
        .update(portalApplicationsTable)
        .set({ ...stagePatch("approved"), decision: body.decision, approvedCompanyId: companyId, reviewedByUserId: req.user!.userId, reviewedAt: now })
        .where(eq(portalApplicationsTable.id, appId))
        .returning();
      await addApplicationEvent(tx, appId, { kind: "approved", stageFrom: app.stage, stageTo: "approved", ...actorOf(req), data: { decision: body.decision, companyId, setup: applied } });
      await writeAuditEvent({
        executor: tx,
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: "portal.application.approved",
        resourceType: "portal_application",
        resourceId: appId,
        beforeData: app,
        afterData: { application: updated, decision: body.decision, companyId, setup: applied },
        decision: "approved",
        reason: "اعتماد طلب انضمام",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      return { companyId, out, issued, customerForDelivery, decision: body.decision, applied };
    });

    let activation: Awaited<ReturnType<typeof deliverActivation>> | null = null;
    if (result.issued && result.customerForDelivery) {
      activation = await deliverActivation(result.customerForDelivery, result.issued, { companyId: result.companyId, staffId: req.user!.userId });
    }
    res.json({ message: "اتوافق على الطلب", decision: result.decision, companyId: result.companyId, setup: result.applied, ...result.out, activation });
  } catch (e) {
    next(e);
  }
});

export default router;
