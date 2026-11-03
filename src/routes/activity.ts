/** @format */
// سجل النشاط السردي (الخطوة 38أ): «أحمد (مدير المبيعات) اعتمد أمر بيع» على جدول audit_events الموجود، من غير جدول جديد.
import { Router } from "express";
import { and, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { auditEventsTable, loginSessionsTable, systemUsersTable } from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { ACTIVITY_SECTIONS, dropShadowedRows, isSectionId, isViewKey, pathRegex, sectionOf } from "../domain/activity-feed";
import { isIsoDate, reportRange } from "../domain/oee";
import { collapseOnline, onlineCutoff } from "../domain/presence";
import { enrichAuditRows } from "../lib/auditEnrich";
import { roleLabel } from "../lib/roleLabels";

const router = Router();

/** السجل بيكشف نشاط كل الموظفين: للإدارة العليا بس (زي /governance/audit). */
export const ACTIVITY_ROLES = ["chairman", "executive_manager"] as const;

const bad = (message: string) => Object.assign(new Error(message), { status: 400 });
const LABEL = new Map(ACTIVITY_SECTIONS.map((s) => [s.id, s.label]));

// GET /api/v1/activity/meta — الأقسام والموظفين للفلاتر
router.get("/activity/meta", requireAuth, requireRole(...ACTIVITY_ROLES), async (_req, res, next) => {
  try {
    const users = await db.select({ id: systemUsersTable.id, name: systemUsersTable.fullName, username: systemUsersTable.username, role: systemUsersTable.role }).from(systemUsersTable).where(eq(systemUsersTable.status, "active")).orderBy(systemUsersTable.fullName);
    res.json({ data: { sections: ACTIVITY_SECTIONS.map((s) => ({ id: s.id, label: s.label })), actors: users.map((u) => ({ id: u.id, name: u.name || u.username, roleLabel: roleLabel(u.role) })) } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/activity/online — النشطين الآن. خصوصية: للإدارة العليا بس، اسم ودور وكام دقيقة، من غير صفحة ولا IP ولا جهاز.
router.get("/activity/online", requireAuth, requireRole(...ACTIVITY_ROLES), async (_req, res, next) => {
  try {
    const now = new Date();
    const pulses = await db
      .select({ userId: loginSessionsTable.userId, lastActiveAt: loginSessionsTable.lastActiveAt })
      .from(loginSessionsTable)
      .where(and(isNull(loginSessionsTable.revokedAt), gte(loginSessionsTable.lastActiveAt, onlineCutoff(now))));
    const online = collapseOnline(pulses, now);
    const users = online.length ? await db.select({ id: systemUsersTable.id, name: systemUsersTable.fullName, username: systemUsersTable.username, role: systemUsersTable.role }).from(systemUsersTable).where(and(inArray(systemUsersTable.id, online.map((o) => o.userId)), eq(systemUsersTable.status, "active"))) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const data = online.flatMap((o) => {
      const u = byId.get(o.userId);
      return u ? [{ userId: u.id, name: u.name || u.username, roleLabel: roleLabel(u.role), minutesAgo: o.minutesAgo }] : [];
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/activity?limit&before&actorId&section&from&to&includeViews — الأحدث أولاً، بترقيم بالـid
router.get("/activity", requireAuth, requireRole(...ACTIVITY_ROLES), async (req, res, next) => {
  try {
    const q = req.query;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
    const conds: SQL[] = [];
    const before = Number(q.before);
    if (q.before !== undefined && q.before !== "") {
      if (!Number.isInteger(before) || before <= 0) throw bad("رقم الصفحة غير صحيح");
      conds.push(lt(auditEventsTable.id, before));
    }
    if (q.actorId !== undefined && q.actorId !== "") {
      const actorId = Number(q.actorId);
      if (!Number.isInteger(actorId) || actorId <= 0) throw bad("الموظف غير صحيح");
      conds.push(eq(auditEventsTable.actorUserId, actorId));
    }
    if (typeof q.section === "string" && q.section !== "") {
      if (!isSectionId(q.section)) throw bad("القسم غير معروف");
      const sec = ACTIVITY_SECTIONS.find((s) => s.id === q.section)!;
      const parts: SQL[] = sec.prefixes.map((p) => sql`starts_with(${auditEventsTable.actionKey}, ${p})`);
      parts.push(sql`${auditEventsTable.actionKey} ~ ${pathRegex(sec.id)!}`);
      conds.push(or(...parts)!);
    }
    const from = typeof q.from === "string" ? q.from : "";
    const to = typeof q.to === "string" ? q.to : "";
    if (from || to) {
      if (!isIsoDate(from) || !isIsoDate(to)) throw bad("حدد الفترة من تاريخ لتاريخ (YYYY-MM-DD)");
      const range = reportRange(from, to);
      if (!range) throw bad("الفترة غير صحيحة (من قبل إلى، وبحد أقصى سنة)");
      conds.push(gte(auditEventsTable.createdAt, range.from), lt(auditEventsTable.createdAt, range.to));
    }
    const includeViews = q.includeViews === "1" || q.includeViews === "true";
    if (!includeViews) conds.push(sql`NOT (${auditEventsTable.actionKey} = 'chat.view' OR ${auditEventsTable.actionKey} LIKE '%.viewed')`);

    // limit+1 عشان نعرف فيه صفحة تانية. الصفوف الخام المخفية بتتحسب من الصفحة المقروءة.
    const fetched = await db.select().from(auditEventsTable).where(conds.length ? and(...conds) : undefined).orderBy(desc(auditEventsTable.id)).limit(limit + 1);
    const hasMore = fetched.length > limit;
    const page = fetched.slice(0, limit);
    const nextBefore = hasMore ? page[page.length - 1]!.id : null;
    const visible = dropShadowedRows(page).filter((r) => includeViews || !isViewKey(r.actionKey));

    const actorIds = [...new Set(visible.map((r) => r.actorUserId).filter((x): x is number => x !== null))];
    const users = actorIds.length ? await db.select({ id: systemUsersTable.id, role: systemUsersTable.role, name: systemUsersTable.fullName }).from(systemUsersTable).where(inArray(systemUsersTable.id, actorIds)) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const enriched = await enrichAuditRows(
      visible.map((r) => {
        const u = r.actorUserId !== null ? byId.get(r.actorUserId) : undefined;
        return { ...r, actorName: u?.name || r.actorName, actorRoleLabel: u ? roleLabel(u.role) : null };
      }),
    );
    // العرض بس: مفيش before/after ولا IP ولا هاش في الرد.
    const data = enriched.map((r) => {
      const section = sectionOf(r.actionKey);
      return { id: r.id, sentence: r.sentence, whenText: r.whenText, createdAt: r.createdAt, actorUserId: r.actorUserId, section, sectionLabel: LABEL.get(section) ?? null, rejected: r.decision === "rejected" };
    });
    res.json({ data, nextBefore });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      res.status((err as Error & { status: number }).status).json({ error: { message: err.message } });
      return;
    }
    next(err);
  }
});

export default router;
