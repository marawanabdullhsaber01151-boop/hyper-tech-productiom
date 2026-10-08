/** @format */
/**
 * Staff view of a company's people: members, join code, company settings and
 * the global portal settings. Staff cannot read or set anyone's password here.
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  portalCustomersTable,
  portalMembersTable,
  portalSettingsTable,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import { revokeMemberSessions } from "../middleware/portal-auth";
import { invalidateMemberAccess } from "../lib/portalAccess";
import { writePortalAudit } from "../lib/portalAudit";
import {
  formatCompanyCode,
  generateCompanyCode,
  getActiveCompanyCode,
} from "../lib/companyCode";
import {
  clearSetting,
  describeSettings,
  getSettingDef,
  validateSettingWrite,
  writeSetting,
} from "../lib/portalSettings";
import { domainError } from "../lib/portalTeam";
import { loadTeamForStaff } from "../lib/portalTeamView";

const router = Router();
const view = [requireAuth, requireRole(...PERMISSIONS.portalCompanies.view)];
const manage = [requireAuth, requireRole(...PERMISSIONS.portalCompanies.manage)];

function id(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw domainError(400, "INVALID_ID", "المعرّف غير صحيح");
  return n;
}
function staff(req: Request) {
  return {
    actorStaffUserId: req.user!.userId,
    actorLabel: `staff:${req.user!.username}`,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  };
}
async function requireCompany(companyId: number) {
  const [c] = await db
    .select({ id: portalCustomersTable.id })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, companyId))
    .limit(1);
  if (!c) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الشركة مش موجودة");
}

router.get(
  "/portal-companies/:id/identity",
  ...view,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const companyId = id(req.params.id);
      await requireCompany(companyId);
      const code = await getActiveCompanyCode(db, companyId);
      const overrides = await db
        .select({ key: portalSettingsTable.key, value: portalSettingsTable.value })
        .from(portalSettingsTable)
        .where(
          and(eq(portalSettingsTable.scope, "company"), eq(portalSettingsTable.scopeId, companyId)),
        );
      res.json({
        members: await loadTeamForStaff(companyId),
        joinCode: code
          ? {
              code: formatCompanyCode(code.code),
              expiresAt: code.expiresAt,
              maxUses: code.maxUses,
              uses: code.uses,
            }
          : null,
        settingOverrides: overrides,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/portal-companies/:id/code/rotate",
  ...manage,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const companyId = id(req.params.id);
      await requireCompany(companyId);
      const created = await db.transaction(async (tx) => {
        const c = await generateCompanyCode(
          tx,
          companyId,
          { staffUserId: req.user!.userId },
          "rotated_by_staff",
        );
        await writePortalAudit(tx, {
          companyId,
          ...staff(req),
          action: "company.code_rotated",
          targetType: "company",
          targetId: companyId,
        });
        return c;
      });
      res.json({ code: formatCompanyCode(created.code) });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/portal-companies/:id/settings",
  ...manage,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const companyId = id(req.params.id);
      await requireCompany(companyId);
      const body = z
        .object({ key: z.string(), value: z.unknown().optional(), reset: z.boolean().optional() })
        .parse(req.body);
      if (!getSettingDef(body.key)) throw domainError(400, "INVALID_SETTING", "الإعداد ده مش موجود");
      await db.transaction(async (tx) => {
        if (body.reset) {
          await clearSetting(tx, { key: body.key, scope: "company", scopeId: companyId });
        } else {
          const value = validateSettingWrite(body.key, "company", body.value, "staff");
          await writeSetting(tx, {
            key: body.key,
            scope: "company",
            scopeId: companyId,
            value,
            updatedBy: `staff:${req.user!.userId}`,
          });
        }
        await writePortalAudit(tx, {
          companyId,
          ...staff(req),
          action: "setting.changed",
          targetType: "setting",
          targetId: body.key,
          after: { value: body.reset ? "reset" : body.value },
        });
      });
      res.json({ message: "اتحفظ" });
    } catch (err) {
      next(err);
    }
  },
);

for (const [action, from, to] of [
  ["suspend", "active", "suspended"],
  ["reactivate", "suspended", "active"],
] as const) {
  router.post(
    `/portal-companies/:id/members/:memberId/${action}`,
    ...manage,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = id(req.params.id);
        const memberId = id(req.params.memberId);
        await db.transaction(async (tx) => {
          const [m] = await tx
            .select()
            .from(portalMembersTable)
            .where(and(eq(portalMembersTable.id, memberId), eq(portalMembersTable.companyId, companyId)))
            .limit(1);
          if (!m) throw domainError(404, "MEMBER_NOT_FOUND", "الموظف مش موجود");
          if (m.isOwner) throw domainError(403, "OWNER_PROTECTED", "رئيس الشركة مينفعش يتوقف من هنا");
          if (m.status !== from) throw domainError(409, "INVALID_STATE", "الحالة مش بتسمح");
          await tx.update(portalMembersTable).set({ status: to }).where(eq(portalMembersTable.id, memberId));
          if (to !== "active") await revokeMemberSessions(memberId, tx);
          await writePortalAudit(tx, {
            companyId,
            ...staff(req),
            action: action === "suspend" ? "member.suspended" : "member.reactivated",
            targetType: "member",
            targetId: memberId,
            before: { status: from },
            after: { status: to },
          });
        });
        invalidateMemberAccess(memberId);
        res.json({ message: "تمام" });
      } catch (err) {
        next(err);
      }
    },
  );
}

/* Global portal settings (WhatsApp numbers, defaults, UI flags). */
router.get("/portal-settings", ...view, async (_req, res, next) => {
  try {
    const rows = await db
      .select({ key: portalSettingsTable.key, value: portalSettingsTable.value })
      .from(portalSettingsTable)
      .where(and(eq(portalSettingsTable.scope, "global"), isNull(portalSettingsTable.scopeId)));
    res.json({ catalog: describeSettings(), values: rows });
  } catch (err) {
    next(err);
  }
});

router.put("/portal-settings", ...manage, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z
      .object({ key: z.string(), value: z.unknown().optional(), reset: z.boolean().optional() })
      .parse(req.body);
    if (!getSettingDef(body.key)) throw domainError(400, "INVALID_SETTING", "الإعداد ده مش موجود");
    if (body.reset) {
      await clearSetting(db, { key: body.key, scope: "global", scopeId: null });
    } else {
      const value = validateSettingWrite(body.key, "global", body.value, "staff");
      await writeSetting(db, {
        key: body.key,
        scope: "global",
        scopeId: null,
        value,
        updatedBy: `staff:${req.user!.userId}`,
      });
    }
    res.json({ message: "اتحفظ" });
  } catch (err) {
    next(err);
  }
});

export default router;
