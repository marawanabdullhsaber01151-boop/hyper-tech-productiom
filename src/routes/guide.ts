/** @format */
// دليل النظام: بيانات حية (أدوار/صلاحيات/صفحات/سياسات اعتماد/مهلة الرد) لأي موظف مسجّل. للقراءة بس. ADR 0040.
import { Router } from "express";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { DEPARTMENTS } from "../lib/departments";
import { APPROVER_ROLES } from "../lib/approvalsInbox";
import { approvalPoliciesTable } from "../db/schema/governance";
import { buildNav, buildRoles, flattenPermissions, groupPolicies, slaSummary } from "../lib/guideCore";

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

export default router;
