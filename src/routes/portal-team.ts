/** @format */
/**
 * Company side of the multi-user portal: team, roles, join requests,
 * company code, company settings, activity log.
 * Every query is scoped by req.portalAuth.companyId — never by an id from the
 * client alone (a member id from another company is simply "not found").
 */
import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { and, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  portalCustomersTable,
  portalMemberOverridesTable,
  portalMembersTable,
  portalRolesTable,
  portalUsersTable,
  portalAuditEventsTable,
} from "../db/schema";
import {
  requirePortalAuth,
  requirePortalPermission,
  revokeMemberSessions,
  revokeUserSessions,
} from "../middleware/portal-auth";
import { invalidateMemberAccess } from "../lib/portalAccess";
import {
  PORTAL_PERMISSIONS,
  PORTAL_PERMISSION_GROUPS,
  isPortalPermissionKey,
  sanitizePermissionList,
} from "../lib/portalPermissions";
import { canGrantAll, findAssignableRole, listCompanyRoles } from "../lib/portalRoles";
import {
  assertSeatAvailable,
  domainError,
  generateTempPassword,
  sanitizeLimits,
} from "../lib/portalTeam";
import { loadTeamForStaff } from "../lib/portalTeamView";
import { writePortalAudit } from "../lib/portalAudit";
import { formatCompanyCode, generateCompanyCode, getActiveCompanyCode } from "../lib/companyCode";
import {
  clearSetting,
  describeSettings,
  validateSettingWrite,
  createSettingsResolver,
  writeSetting,
  getSettingDef,
} from "../lib/portalSettings";
import { normalizeEmail, normalizePhone } from "../lib/identityNormalization";
import { buildWhatsAppLink } from "../lib/portalActivation";

const router = Router();
const auth = [requirePortalAuth];

function me(req: Request) {
  const a = req.portalAuth;
  if (!a) throw domainError(401, "NO_IDENTITY", "سجّل دخول تاني");
  return a;
}
function actorOf(req: Request) {
  const a = me(req);
  return {
    companyId: a.companyId,
    actorMemberId: a.memberId,
    actorLabel: `member:${a.memberId}`,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  };
}
function idParam(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw domainError(400, "INVALID_ID", "المعرّف غير صحيح");
  return n;
}

/* ---------------------------- views ---------------------------- */

async function loadMemberInCompany(companyId: number, memberId: number) {
  const [row] = await db
    .select()
    .from(portalMembersTable)
    .where(and(eq(portalMembersTable.id, memberId), eq(portalMembersTable.companyId, companyId)))
    .limit(1);
  if (!row || row.status === "removed") {
    throw domainError(404, "MEMBER_NOT_FOUND", "الموظف ده مش موجود");
  }
  return row;
}

/* ---------------------------- permissions registry ---------------------------- */

/** الثيم الفعلي للعضو (عضو ← شركة ← عام ← افتراضي). بيتحمّل مع أول رسم للواجهة. */
router.get("/portal/theme", ...auth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const a = req.portalAuth!;
    const resolver = await createSettingsResolver({ companyId: a.companyId, memberId: a.memberId });
    res.json({
      accent: resolver.get<string>("ui.theme.accent"),
      radius: resolver.get<string>("ui.theme.radius"),
      density: resolver.get<string>("ui.theme.density"),
      fontScale: resolver.get<number>("ui.theme.font_scale"),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/portal/permissions", ...auth, requirePortalPermission("team.view"), (_req, res) => {
  res.json({ groups: PORTAL_PERMISSION_GROUPS, permissions: PORTAL_PERMISSIONS });
});

router.get(
  "/portal/roles",
  ...auth,
  requirePortalPermission("team.view"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roles = await listCompanyRoles(db, me(req).companyId);
      res.json({
        roles: roles.map((r) => ({
          id: r.id,
          key: r.key,
          name: r.name,
          description: r.description,
          permissions: r.permissions,
          isSystem: r.isSystem,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

const roleBodySchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,30}$/, "المفتاح حروف إنجليزي صغيرة وأرقام و _"),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).optional().nullable(),
  permissions: z.array(z.string()).max(40),
});

router.post(
  "/portal/roles",
  ...auth,
  requirePortalPermission("team.manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = me(req);
      const body = roleBodySchema.parse(req.body);
      if (body.key === "owner") throw domainError(400, "RESERVED_ROLE", "الاسم ده محجوز");
      const permissions = sanitizePermissionList(body.permissions);
      if (!canGrantAll(a, permissions)) {
        throw domainError(403, "CANNOT_GRANT", "مينفعش تدّي صلاحيات مش عندك");
      }
      const role = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: portalRolesTable.id })
          .from(portalRolesTable)
          .where(and(eq(portalRolesTable.companyId, a.companyId), eq(portalRolesTable.key, body.key)))
          .limit(1);
        if (existing) throw domainError(409, "ROLE_EXISTS", "فيه دور بنفس المفتاح");
        const [created] = await tx
          .insert(portalRolesTable)
          .values({
            companyId: a.companyId,
            key: body.key,
            name: body.name,
            description: body.description ?? null,
            permissions,
            isSystem: false,
            sortOrder: 100,
          })
          .returning();
        await writePortalAudit(tx, {
          ...actorOf(req),
          action: "role.created",
          targetType: "role",
          targetId: created!.id,
          after: { key: body.key, name: body.name, permissions },
        });
        return created!;
      });
      res.status(201).json({ role });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/portal/roles/:roleId",
  ...auth,
  requirePortalPermission("team.manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = me(req);
      const roleId = idParam(req.params.roleId);
      const body = roleBodySchema.partial().omit({ key: true }).parse(req.body);
      const permissions = body.permissions ? sanitizePermissionList(body.permissions) : undefined;
      if (permissions && !canGrantAll(a, permissions)) {
        throw domainError(403, "CANNOT_GRANT", "مينفعش تدّي صلاحيات مش عندك");
      }
      await db.transaction(async (tx) => {
        const [role] = await tx
          .select()
          .from(portalRolesTable)
          .where(and(eq(portalRolesTable.id, roleId), eq(portalRolesTable.companyId, a.companyId)))
          .limit(1);
        if (!role) throw domainError(404, "ROLE_NOT_FOUND", "الدور مش موجود");
        await tx
          .update(portalRolesTable)
          .set({
            ...(body.name ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(permissions ? { permissions } : {}),
          })
          .where(eq(portalRolesTable.id, roleId));
        await writePortalAudit(tx, {
          ...actorOf(req),
          action: "role.updated",
          targetType: "role",
          targetId: roleId,
          before: { name: role.name, permissions: role.permissions },
          after: { name: body.name ?? role.name, permissions: permissions ?? role.permissions },
        });
      });
      invalidateMemberAccess();
      res.json({ message: "اتحفظ" });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/portal/roles/:roleId",
  ...auth,
  requirePortalPermission("team.manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = me(req);
      const roleId = idParam(req.params.roleId);
      await db.transaction(async (tx) => {
        const [role] = await tx
          .select()
          .from(portalRolesTable)
          .where(and(eq(portalRolesTable.id, roleId), eq(portalRolesTable.companyId, a.companyId)))
          .limit(1);
        if (!role) throw domainError(404, "ROLE_NOT_FOUND", "الدور مش موجود");
        const [{ n } = { n: 0 }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(portalMembersTable)
          .where(
            and(eq(portalMembersTable.roleId, roleId), ne(portalMembersTable.status, "removed")),
          );
        if (n > 0) {
          throw domainError(409, "ROLE_IN_USE", "الدور ده مستخدم عند موظفين. غيّر أدوارهم الأول");
        }
        await tx.delete(portalRolesTable).where(eq(portalRolesTable.id, roleId));
        await writePortalAudit(tx, {
          ...actorOf(req),
          action: "role.deleted",
          targetType: "role",
          targetId: roleId,
          before: { key: role.key, name: role.name },
        });
      });
      res.json({ message: "اتمسح" });
    } catch (err) {
      next(err);
    }
  },
);

/* ---------------------------- team ---------------------------- */

router.get(
  "/portal/team",
  ...auth,
  requirePortalPermission("team.view"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = me(req);
      const members = await loadTeamForStaff(a.companyId);
      const resolver = await createSettingsResolver({ companyId: a.companyId });
      res.json({
        members,
        maxMembers: resolver.get<number>("team.max_members"),
        pendingRequests: members.filter((m) => m.status === "pending_approval").length,
      });
    } catch (err) {
      next(err);
    }
  },
);

const addMemberSchema = z.object({
  fullName: z.string().trim().min(2, "الاسم مطلوب").max(100),
  phone: z.string().trim().min(8, "رقم هاتف غير صحيح").max(20),
  email: z.string().trim().email("بريد غير صحيح").optional().nullable().or(z.literal("")),
  roleKey: z.string().trim().min(1),
  title: z.string().trim().max(80).optional().nullable(),
  limits: z.record(z.string(), z.unknown()).optional(),
  password: z.string().min(6).max(100).optional(),
});

router.post(
  "/portal/team",
  ...auth,
  requirePortalPermission("team.invite"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = me(req);
      const body = addMemberSchema.parse(req.body);
      const phone = normalizePhone(body.phone);
      if (!phone) throw domainError(400, "INVALID_PHONE", "رقم هاتف غير صحيح");
      const email = body.email ? normalizeEmail(body.email) : "";

      const result = await db.transaction(async (tx) => {
        // Serialize team changes of one company (seat count, duplicates).
        await tx
          .select({ id: portalCustomersTable.id })
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.id, a.companyId))
          .for("update");
        const role = await findAssignableRole(tx, a.companyId, body.roleKey);
        if (!role) throw domainError(400, "INVALID_ROLE", "الدور ده مش متاح");
        if (!canGrantAll(a, role.permissions)) {
          throw domainError(403, "CANNOT_GRANT", "مينفعش تدّي دور فيه صلاحيات مش عندك");
        }
        await assertSeatAvailable(tx, a.companyId);

        const [phoneTaken] = await tx
          .select({ id: portalUsersTable.id })
          .from(portalUsersTable)
          .where(eq(portalUsersTable.normalizedPhone, phone))
          .limit(1);
        if (phoneTaken) {
          throw domainError(
            409,
            "PHONE_ALREADY_REGISTERED",
            "الرقم ده عنده حساب بالفعل. خليه ينضم بكود الشركة",
          );
        }
        if (email) {
          const [emailTaken] = await tx
            .select({ id: portalUsersTable.id })
            .from(portalUsersTable)
            .where(eq(portalUsersTable.normalizedEmail, email))
            .limit(1);
          if (emailTaken) {
            throw domainError(409, "EMAIL_ALREADY_REGISTERED", "الإيميل ده مستخدم قبل كده");
          }
        }

        const tempPassword = body.password ?? generateTempPassword();
        const [user] = await tx
          .insert(portalUsersTable)
          .values({
            phone: body.phone.trim(),
            normalizedPhone: phone,
            email: body.email ? body.email.trim() : null,
            normalizedEmail: email || null,
            passwordHash: await bcrypt.hash(tempPassword, 12),
            fullName: body.fullName,
            mustChangePassword: true,
            activatedAt: new Date(),
          })
          .returning({ id: portalUsersTable.id });
        const [member] = await tx
          .insert(portalMembersTable)
          .values({
            companyId: a.companyId,
            userId: user!.id,
            roleId: role.id,
            status: "active",
            joinedVia: a.isOwner ? "owner_created" : "admin_created",
            invitedByMemberId: a.memberId,
            title: body.title ?? null,
            limits: sanitizeLimits(body.limits),
          })
          .returning({ id: portalMembersTable.id });
        await writePortalAudit(tx, {
          ...actorOf(req),
          action: "member.created",
          targetType: "member",
          targetId: member!.id,
          after: { fullName: body.fullName, role: role.key },
        });
        return { memberId: member!.id, tempPassword };
      });

      const [company] = await db
        .select({ name: portalCustomersTable.companyName })
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, a.companyId))
        .limit(1);
      const message = `أهلاً ${body.fullName}، اتضفت لحساب ${company?.name ?? "الشركة"} في Hyper-Tech.\nرقمك: ${body.phone.trim()}\nكلمة السر المؤقتة: ${result.tempPassword}\nهتغيّرها أول ما تدخل.`;
      res.status(201).json({
        memberId: result.memberId,
        tempPassword: result.tempPassword,
        whatsappUrl: buildWhatsAppLink(body.phone, message),
        message,
      });
    } catch (err) {
      next(err);
    }
  },
);

const patchMemberSchema = z.object({
  roleKey: z.string().trim().min(1).optional(),
  title: z.string().trim().max(80).nullable().optional(),
  limits: z.record(z.string(), z.unknown()).optional(),
  overrides: z
    .array(z.object({ permissionKey: z.string(), effect: z.enum(["allow", "deny"]) }))
    .max(40)
    .optional(),
});

router.patch(
  "/portal/team/:memberId",
  ...auth,
  requirePortalPermission("team.manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = me(req);
      const memberId = idParam(req.params.memberId);
      const body = patchMemberSchema.parse(req.body);
      await db.transaction(async (tx) => {
        const target = await loadMemberInCompany(a.companyId, memberId);
        if (target.isOwner) {
          throw domainError(403, "OWNER_PROTECTED", "رئيس الشركة مينفعش يتعدّل من هنا");
        }
        if (target.id === a.memberId) {
          throw domainError(403, "SELF_EDIT", "مينفعش تعدّل صلاحياتك بنفسك");
        }
        const patch: Record<string, unknown> = {};
        if (body.roleKey) {
          const role = await findAssignableRole(tx, a.companyId, body.roleKey);
          if (!role) throw domainError(400, "INVALID_ROLE", "الدور ده مش متاح");
          if (!canGrantAll(a, role.permissions)) {
            throw domainError(403, "CANNOT_GRANT", "مينفعش تدّي دور فيه صلاحيات مش عندك");
          }
          patch.roleId = role.id;
        }
        if (body.title !== undefined) patch.title = body.title;
        if (body.limits !== undefined) patch.limits = sanitizeLimits(body.limits);
        if (Object.keys(patch).length) {
          await tx.update(portalMembersTable).set(patch).where(eq(portalMembersTable.id, memberId));
        }
        if (body.overrides) {
          const clean = body.overrides.filter((o) => isPortalPermissionKey(o.permissionKey));
          const allows = clean.filter((o) => o.effect === "allow").map((o) => o.permissionKey);
          if (!canGrantAll(a, allows)) {
            throw domainError(403, "CANNOT_GRANT", "مينفعش تدّي صلاحيات مش عندك");
          }
          await tx
            .delete(portalMemberOverridesTable)
            .where(eq(portalMemberOverridesTable.memberId, memberId));
          if (clean.length) {
            await tx
              .insert(portalMemberOverridesTable)
              .values(clean.map((o) => ({ memberId, permissionKey: o.permissionKey, effect: o.effect })));
          }
        }
        await writePortalAudit(tx, {
          ...actorOf(req),
          action: "member.updated",
          targetType: "member",
          targetId: memberId,
          after: {
            role: body.roleKey,
            title: body.title,
            limits: body.limits ? sanitizeLimits(body.limits) : undefined,
            overrides: body.overrides?.length,
          },
        });
      });
      invalidateMemberAccess(memberId);
      res.json({ message: "اتحفظ" });
    } catch (err) {
      next(err);
    }
  },
);

function memberStatusRoute(
  action: "suspend" | "reactivate" | "remove",
  from: string[],
  to: "suspended" | "active" | "removed",
  auditAction: string,
) {
  router.post(
    `/portal/team/:memberId/${action}`,
    ...auth,
    requirePortalPermission("team.manage"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const a = me(req);
        const memberId = idParam(req.params.memberId);
        await db.transaction(async (tx) => {
          const target = await loadMemberInCompany(a.companyId, memberId);
          if (target.isOwner) {
            throw domainError(403, "OWNER_PROTECTED", "رئيس الشركة مينفعش يتوقف أو يتشال");
          }
          if (target.id === a.memberId) {
            throw domainError(403, "SELF_EDIT", "مينفعش تعمل كده في حسابك");
          }
          if (!from.includes(target.status)) {
            throw domainError(409, "INVALID_STATE", "الحالة الحالية للموظف مش بتسمح بالإجراء ده");
          }
          if (to === "active") await assertSeatAvailable(tx, a.companyId);
          await tx
            .update(portalMembersTable)
            .set({ status: to })
            .where(eq(portalMembersTable.id, memberId));
          if (to !== "active") await revokeMemberSessions(memberId, tx);
          await writePortalAudit(tx, {
            ...actorOf(req),
            action: auditAction,
            targetType: "member",
            targetId: memberId,
            before: { status: target.status },
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
memberStatusRoute("suspend", ["active"], "suspended", "member.suspended");
memberStatusRoute("reactivate", ["suspended"], "active", "member.reactivated");
memberStatusRoute("remove", ["active", "suspended", "invited"], "removed", "member.removed");

router.post(
  "/portal/team/:memberId/reset-password",
  ...auth,
  requirePortalPermission("team.manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = me(req);
      const memberId = idParam(req.params.memberId);
      const out = await db.transaction(async (tx) => {
        const target = await loadMemberInCompany(a.companyId, memberId);
        if (target.isOwner || target.id === a.memberId) {
          throw domainError(403, "NOT_ALLOWED", "مينفعش تعمل كده لنفسك أو لرئيس الشركة");
        }
        // The password belongs to the PERSON. Only reset it if this company
        // created the person and they belong to no other company.
        const memberships = await tx
          .select({ id: portalMembersTable.id })
          .from(portalMembersTable)
          .where(
            and(
              eq(portalMembersTable.userId, target.userId),
              ne(portalMembersTable.status, "removed"),
            ),
          );
        if (
          memberships.length > 1 ||
          !(target.joinedVia === "owner_created" || target.joinedVia === "admin_created")
        ) {
          throw domainError(
            409,
            "SHARED_ACCOUNT",
            "الحساب ده بتاع شخص ليه حسابات في شركات تانية. يستخدم 'نسيت كلمة السر'",
          );
        }
        const tempPassword = generateTempPassword();
        await tx
          .update(portalUsersTable)
          .set({
            passwordHash: await bcrypt.hash(tempPassword, 12),
            mustChangePassword: true,
            failedLoginAttempts: 0,
            lockedUntil: null,
          })
          .where(eq(portalUsersTable.id, target.userId));
        await revokeUserSessions(target.userId, tx);
        await writePortalAudit(tx, {
          ...actorOf(req),
          action: "member.password_reset",
          targetType: "member",
          targetId: memberId,
        });
        const [u] = await tx
          .select({ phone: portalUsersTable.phone, fullName: portalUsersTable.fullName })
          .from(portalUsersTable)
          .where(eq(portalUsersTable.id, target.userId))
          .limit(1);
        return { tempPassword, phone: u?.phone ?? "", fullName: u?.fullName ?? "" };
      });
      const message = `أهلاً ${out.fullName}، كلمة السر المؤقتة الجديدة: ${out.tempPassword}\nهتغيّرها أول ما تدخل.`;
      res.json({
        tempPassword: out.tempPassword,
        whatsappUrl: buildWhatsAppLink(out.phone, message),
        message,
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ---------------------------- join requests ---------------------------- */

router.get(
  "/portal/team/requests",
  ...auth,
  requirePortalPermission("team.approve_join"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const members = (await loadTeamForStaff(me(req).companyId)).filter(
        (m) => m.status === "pending_approval",
      );
      res.json({ requests: members });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/portal/team/requests/:memberId/approve",
  ...auth,
  requirePortalPermission("team.approve_join"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = me(req);
      const memberId = idParam(req.params.memberId);
      const body = z.object({ roleKey: z.string().optional() }).parse(req.body ?? {});
      await db.transaction(async (tx) => {
        await tx
          .select({ id: portalCustomersTable.id })
          .from(portalCustomersTable)
          .where(eq(portalCustomersTable.id, a.companyId))
          .for("update");
        const target = await loadMemberInCompany(a.companyId, memberId);
        if (target.status !== "pending_approval") {
          throw domainError(409, "INVALID_STATE", "الطلب ده اتعالج قبل كده");
        }
        let roleId = target.roleId;
        if (body.roleKey) {
          const role = await findAssignableRole(tx, a.companyId, body.roleKey);
          if (!role) throw domainError(400, "INVALID_ROLE", "الدور ده مش متاح");
          if (!canGrantAll(a, role.permissions)) {
            throw domainError(403, "CANNOT_GRANT", "مينفعش تدّي دور فيه صلاحيات مش عندك");
          }
          roleId = role.id;
        }
        await tx
          .update(portalMembersTable)
          .set({ status: "active", roleId, approvedByMemberId: a.memberId })
          .where(eq(portalMembersTable.id, memberId));
        await writePortalAudit(tx, {
          ...actorOf(req),
          action: "join.approved",
          targetType: "member",
          targetId: memberId,
        });
      });
      res.json({ message: "اتقبل" });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/portal/team/requests/:memberId/reject",
  ...auth,
  requirePortalPermission("team.approve_join"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = me(req);
      const memberId = idParam(req.params.memberId);
      await db.transaction(async (tx) => {
        const target = await loadMemberInCompany(a.companyId, memberId);
        if (target.status !== "pending_approval") {
          throw domainError(409, "INVALID_STATE", "الطلب ده اتعالج قبل كده");
        }
        await tx
          .update(portalMembersTable)
          .set({ status: "removed" })
          .where(eq(portalMembersTable.id, memberId));
        await writePortalAudit(tx, {
          ...actorOf(req),
          action: "join.rejected",
          targetType: "member",
          targetId: memberId,
        });
      });
      res.json({ message: "اترفض" });
    } catch (err) {
      next(err);
    }
  },
);

/* ---------------------------- company ---------------------------- */

const COMPANY_EDITABLE_SETTINGS = [
  "join.mode",
  "join.code.enabled",
  "join.code.expires_at",
  "join.code.max_uses",
  "join.default_role",
  "cart.scope",
  "chat.mode",
  "ui.theme.accent",
  "ui.theme.radius",
  "ui.theme.density",
  "ui.theme.font_scale",
];

router.get(
  "/portal/company",
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = me(req);
      const [company] = await db
        .select({
          id: portalCustomersTable.id,
          companyName: portalCustomersTable.companyName,
          city: portalCustomersTable.city,
        })
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, a.companyId))
        .limit(1);
      const canCode = a.can("company.manage_code");
      const code = canCode ? await getActiveCompanyCode(db, a.companyId) : null;
      const resolver = await createSettingsResolver({ companyId: a.companyId });
      res.json({
        company,
        joinCode: code
          ? {
              code: formatCompanyCode(code.code),
              expiresAt: code.expiresAt,
              maxUses: code.maxUses,
              uses: code.uses,
            }
          : null,
        settings: Object.fromEntries(
          COMPANY_EDITABLE_SETTINGS.map((k) => [k, resolver.get(k)]),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/portal/company/settings",
  ...auth,
  requirePortalPermission("company.settings"),
  (_req, res) => {
    res.json({
      settings: describeSettings().filter((s) => COMPANY_EDITABLE_SETTINGS.includes(s.key)),
    });
  },
);

router.put(
  "/portal/company/settings",
  ...auth,
  requirePortalPermission("company.settings"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = me(req);
      const body = z
        .object({ key: z.string(), value: z.unknown().optional(), reset: z.boolean().optional() })
        .parse(req.body);
      if (!COMPANY_EDITABLE_SETTINGS.includes(body.key) || !getSettingDef(body.key)) {
        throw domainError(400, "INVALID_SETTING", "الإعداد ده مش متاح");
      }
      await db.transaction(async (tx) => {
        if (body.reset) {
          await clearSetting(tx, { key: body.key, scope: "company", scopeId: a.companyId });
        } else {
          const value = validateSettingWrite(body.key, "company", body.value, "owner");
          await writeSetting(tx, {
            key: body.key,
            scope: "company",
            scopeId: a.companyId,
            value,
            updatedBy: `member:${a.memberId}`,
          });
        }
        await writePortalAudit(tx, {
          ...actorOf(req),
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

router.post(
  "/portal/company/code/rotate",
  ...auth,
  requirePortalPermission("company.manage_code"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = me(req);
      const created = await db.transaction(async (tx) => {
        const c = await generateCompanyCode(tx, a.companyId, { memberId: a.memberId }, "rotated");
        await writePortalAudit(tx, {
          ...actorOf(req),
          action: "company.code_rotated",
          targetType: "company",
          targetId: a.companyId,
        });
        return c;
      });
      res.json({ code: formatCompanyCode(created.code) });
    } catch (err) {
      next(err);
    }
  },
);

/* ---------------------------- audit ---------------------------- */

router.get(
  "/portal/audit",
  ...auth,
  requirePortalPermission("audit.view"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = me(req);
      const q = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(30),
          before: z.coerce.number().int().positive().optional(),
        })
        .parse(req.query);
      const rows = await db
        .select()
        .from(portalAuditEventsTable)
        .where(
          and(
            eq(portalAuditEventsTable.companyId, a.companyId),
            q.before ? lt(portalAuditEventsTable.id, q.before) : undefined,
          ),
        )
        .orderBy(desc(portalAuditEventsTable.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      res.json({
        events: page.map((e) => ({
          id: e.id,
          action: e.action,
          actorMemberId: e.actorMemberId,
          actorLabel: e.actorLabel,
          targetType: e.targetType,
          targetId: e.targetId,
          before: e.before,
          after: e.after,
          createdAt: e.createdAt,
        })),
        nextBefore: rows.length > q.limit ? page[page.length - 1]!.id : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
