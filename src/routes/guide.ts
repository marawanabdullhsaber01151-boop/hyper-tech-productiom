/** @format */
// دليل النظام: بيانات حية (أدوار/صلاحيات/صفحات/سياسات اعتماد/مهلة الرد) لأي موظف مسجّل. للقراءة بس. ADR 0040.
import { Router } from "express";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db, delegationsTable, permissionOverridesTable } from "../db";
import { findAction } from "../lib/actionRegistry";
import { requireAuth } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { DEPARTMENTS } from "../lib/departments";
import { APPROVER_ROLES } from "../lib/approvalsInbox";
import { approvalPoliciesTable } from "../db/schema/governance";
import { buildMine, buildNav, buildRoles, flattenPermissions, groupPolicies, slaSummary } from "../lib/guideCore";

const router = Router();

router.get("/guide/live", requireAuth, async (_req, res, next) => {
  try {
    const rows = await db.select().from(approvalPoliciesTable);
    res.json({
      roles: buildRoles(APPROVER_ROLES),
      permissions: flattenPermissions(PERMISSIONS as unknown as Record<string, Record<string, readonly string[]>>),
      nav: buildNav(DEPARTMENTS),
      policies: groupPolicies(rows.map((r) => ({ actionKey: r.actionKey, minAmount: String(r.minAmount), approverRoles: r.approverRoles, sequence: r.sequence, requiredApprovals: r.requiredApprovals, active: r.active }))),
      sla: slaSummary(),
    });
  } catch (err) {
    next(err);
  }
});

/** صلاحياتي الفعلية: الدور + اللي اتضاف/اتسحب (مؤقت أو دائم) + تفويضات سارية. الدليل بيبني كتالوجي منها. */
router.get("/guide/mine", requireAuth, async (req, res, next) => {
  try {
    const user = req.user!;
    const now = new Date();
    const [overrides, delegations] = await Promise.all([
      db.select({ actionKey: permissionOverridesTable.actionKey, allowed: permissionOverridesTable.allowed, expiresAt: permissionOverridesTable.expiresAt })
        .from(permissionOverridesTable)
        .where(and(eq(permissionOverridesTable.userId, user.userId), isNull(permissionOverridesTable.revokedAt))),
      db.select({ actionKey: delegationsTable.actionKey, startsAt: delegationsTable.startsAt, endsAt: delegationsTable.endsAt })
        .from(delegationsTable)
        .where(and(eq(delegationsTable.delegateUserId, user.userId), eq(delegationsTable.status, "active"), isNull(delegationsTable.revokedAt), lte(delegationsTable.startsAt, now), gte(delegationsTable.endsAt, now))),
    ]);
    res.json(buildMine({ role: user.role, overrides, delegations, now, find: findAction }));
  } catch (err) {
    next(err);
  }
});

export default router;
