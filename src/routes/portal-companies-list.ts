/** @format */
/**
 * Plan 05 — admin command center for portal companies: list / detail / people
 * management / bulk actions / CSV / activity log / settings history.
 * Everything here is staff-only (PERMISSIONS.portalCompanies.*).
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  portalAuditEventsTable,
  portalCustomersTable,
  portalMemberOverridesTable,
  portalMembersTable,
  portalSessionsTable,
  portalSettingsTable,
  productionWorkflowOrdersTable,
  portalUsersTable,
  portalRolesTable,
  salesOrdersTable,
  systemUsersTable,
  contactsTable,
} from "../db/schema";
import { CONTACT_SEGMENTS, EGYPT_GOVERNORATES } from "../db/schema/contacts";
import { requireAuth, requireRole } from "../middleware/auth";
import { PERMISSIONS } from "../lib/permissions";
import {
  revokeAllPortalSessions,
  revokeMemberSessions,
} from "../middleware/portal-auth";
import { invalidateMemberAccess } from "../lib/portalAccess";
import { writePortalAudit } from "../lib/portalAudit";
import { writeAuditEvent } from "../lib/governance";
import {
  FINISHED_ORDER_STATUSES,
  archiveNeedsOpenOrdersConfirmation,
  canPlainReactivate,
  parseArchiveReason,
  restoredCompanyFields,
} from "../lib/companyArchive";
import { domainError, sanitizeLimits } from "../lib/portalTeam";
import { loadTeamForStaff } from "../lib/portalTeamView";
import { createMemberAccount } from "../lib/portalMemberCreate";
import { findAssignableRole, listCompanyRoles } from "../lib/portalRoles";
import { isPortalPermissionKey, PORTAL_PERMISSION_GROUPS, PORTAL_PERMISSIONS } from "../lib/portalPermissions";
import { buildWhatsAppLink } from "../lib/portalActivation";
import { buildPortalPageUrl } from "../lib/portalConfig";
import { issueAuthToken } from "../lib/authTokens";
import { humanDuration } from "../lib/channels/templates";
import { formatCompanyCode, getActiveCompanyCode } from "../lib/companyCode";
import {
  describeSettings,
  describeShape,
  getSettingDef,
  createSettingsResolver,
  PORTAL_SETTING_DEFS,
  resolveSetting,
} from "../lib/portalSettings";
import {
  changeSetting,
  listSettingHistory,
  revertSettingChange,
} from "../lib/portalSettingsHistory";
import {
  companyListQuery,
  loadCompanyRow,
  queryCompanies,
} from "../lib/portalCompaniesQuery";
import { toCsv } from "../lib/csv";

const router = Router();
const view = [requireAuth, requireRole(...PERMISSIONS.portalCompanies.view)];
const manage = [requireAuth, requireRole(...PERMISSIONS.portalCompanies.manage)];

const STATUS_LABEL: Record<string, string> = {
  not_activated: "لسه ما اتفعّلش",
  active: "شغال",
  suspended: "موقوف",
  archived: "مؤرشف",
};

function id(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw domainError(400, "INVALID_ID", "المعرّف غير صحيح");
  return n;
}
function staffActor(req: Request) {
  return {
    actorStaffUserId: req.user!.userId,
    actorLabel: `staff:${req.user!.username}`,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  };
}
function staffName(req: Request) {
  return `staff:${req.user!.userId}`;
}
async function requireCompanyRow(companyId: number) {
  const row = await loadCompanyRow(companyId);
  if (!row) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الشركة مش موجودة");
  return row;
}
async function memberInCompany(tx: Pick<typeof db, "select">, companyId: number, memberId: number) {
  const [m] = await tx
    .select()
    .from(portalMembersTable)
    .where(and(eq(portalMembersTable.id, memberId), eq(portalMembersTable.companyId, companyId)))
    .limit(1);
  if (!m) throw domainError(404, "MEMBER_NOT_FOUND", "الموظف مش موجود");
  return m;
}

/* ------------------------------------------------------------------ */
/* Meta for filters / pickers                                          */
/* ------------------------------------------------------------------ */
router.get("/portal-companies/meta", ...view, async (_req, res, next) => {
  try {
    const sales = await db
      .select({ id: systemUsersTable.id, fullName: systemUsersTable.fullName, role: systemUsersTable.role })
      .from(systemUsersTable)
      .where(
        and(
          eq(systemUsersTable.status, "active"),
          inArray(systemUsersTable.role, PERMISSIONS.sales.write as unknown as string[]),
        ),
      )
      .orderBy(systemUsersTable.fullName);
    res.json({ salesUsers: sales, segments: CONTACT_SEGMENTS, governorates: EGYPT_GOVERNORATES });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* List + CSV                                                          */
/* ------------------------------------------------------------------ */
router.get("/portal-companies/permissions", ...view, (_req, res) => {
  res.json({
    groups: PORTAL_PERMISSION_GROUPS,
    permissions: PORTAL_PERMISSIONS.map((p) => ({ key: p.key, group: p.group, label: p.label, description: p.description, dangerous: !!p.dangerous })),
  });
});

router.get("/portal-companies", ...view, async (req, res, next) => {
  try {
    const f = companyListQuery.parse(req.query);
    const { items, total } = await queryCompanies(f);
    res.json({ items, total, page: f.page, pageSize: f.pageSize });
  } catch (e) {
    next(e);
  }
});

router.get("/portal-companies/export.csv", ...view, async (req, res, next) => {
  try {
    const f = companyListQuery.parse(req.query);
    const ids = z
      .string()
      .regex(/^\d+(,\d+){0,199}$/)
      .optional()
      .parse(typeof req.query.ids === "string" ? req.query.ids : undefined);
    let { items } = await queryCompanies(f, { all: true });
    if (ids) {
      const wanted = new Set(ids.split(",").map(Number));
      items = items.filter((c) => wanted.has(c.id));
    }
    const rows: unknown[][] = [
      ["الشركة", "المالك", "الهاتف", "البريد", "المحافظة", "التصنيف", "الحالة", "عدد الأعضاء", "عدد الطلبات", "آخر طلب", "آخر نشاط", "مسؤول المبيعات", "مؤشر الصحة", "تاريخ الإنشاء"],
      ...items.map((c) => [
        c.companyName,
        c.ownerName,
        c.phone,
        c.email ?? "",
        c.governorate ?? "",
        c.segment ?? "",
        STATUS_LABEL[c.status],
        c.membersCount,
        c.ordersCount,
        c.lastOrderAt ? new Date(c.lastOrderAt).toISOString() : "",
        c.lastActivityAt ? new Date(c.lastActivityAt).toISOString() : "",
        c.salesName ?? "",
        c.health.label,
        new Date(c.createdAt).toISOString(),
      ]),
    ];
    res
      .status(200)
      .setHeader("Content-Type", "text/csv; charset=utf-8")
      .setHeader("Content-Disposition", 'attachment; filename="portal-companies.csv"')
      .send(toCsv(rows));
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* Bulk                                                                */
/* ------------------------------------------------------------------ */
const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assignSales"), ids: z.array(z.number().int().positive()).min(1).max(200), salesUserId: z.number().int().positive().nullable() }),
  z.object({ action: z.literal("segment"), ids: z.array(z.number().int().positive()).min(1).max(200), segment: z.enum(CONTACT_SEGMENTS) }),
  z.object({ action: z.literal("status"), ids: z.array(z.number().int().positive()).min(1).max(200), status: z.enum(["suspend", "reactivate"]) }),
]);

router.post("/portal-companies/bulk", ...manage, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = bulkSchema.parse(req.body);
    const ids = [...new Set(body.ids)];
    if (body.action === "assignSales" && body.salesUserId) {
      const [u] = await db
        .select({ id: systemUsersTable.id, role: systemUsersTable.role })
        .from(systemUsersTable)
        .where(eq(systemUsersTable.id, body.salesUserId))
        .limit(1);
      if (!u || !(PERMISSIONS.sales.write as readonly string[]).includes(u.role)) {
        throw domainError(400, "INVALID_SALES_USER", "اختار موظف مبيعات موجود");
      }
    }
    const result = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: portalCustomersTable.id,
          contactId: portalCustomersTable.contactId,
          isActive: portalCustomersTable.isActive,
          archivedAt: portalCustomersTable.archivedAt,
          assignedSalesUserId: portalCustomersTable.assignedSalesUserId,
        })
        .from(portalCustomersTable)
        .where(inArray(portalCustomersTable.id, ids))
        .for("update");
      const found = new Map(rows.map((r) => [r.id, r]));
      const missing = ids.filter((x) => !found.has(x));
      if (missing.length) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "فيه شركات مش موجودة في الاختيار");

      for (const row of rows) {
        if (body.action === "assignSales") {
          await tx.update(portalCustomersTable).set({ assignedSalesUserId: body.salesUserId }).where(eq(portalCustomersTable.id, row.id));
          await writePortalAudit(tx, {
            companyId: row.id, ...staffActor(req), action: "company.sales_assigned", targetType: "company", targetId: row.id,
            before: { salesUserId: row.assignedSalesUserId }, after: { salesUserId: body.salesUserId },
          });
        } else if (body.action === "segment") {
          await tx.update(contactsTable).set({ segment: body.segment }).where(eq(contactsTable.id, row.contactId));
          await writePortalAudit(tx, {
            companyId: row.id, ...staffActor(req), action: "company.segment_changed", targetType: "company", targetId: row.id,
            after: { segment: body.segment },
          });
        } else {
          const isActive = body.status === "reactivate";
          if (isActive && !canPlainReactivate(row.archivedAt)) {
            throw domainError(409, "COMPANY_ARCHIVED", "فيه شركات مؤرشفة في الاختيار — استرجعها من الأرشيف الأول");
          }
          if (row.isActive === isActive) continue;
          await tx.update(portalCustomersTable).set({ isActive }).where(eq(portalCustomersTable.id, row.id));
          if (!isActive) await revokeAllPortalSessions(row.id, tx);
          await writePortalAudit(tx, {
            companyId: row.id, ...staffActor(req), action: isActive ? "company.reactivated" : "company.suspended", targetType: "company", targetId: row.id,
            before: { isActive: row.isActive }, after: { isActive },
          });
        }
      }
      await writeAuditEvent({
        executor: tx,
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: `portal.companies.bulk.${body.action}`,
        resourceType: "portal_customer",
        resourceId: ids[0]!,
        afterData: { count: ids.length, ids, ...("status" in body ? { status: body.status } : {}) },
        reason: "عملية جماعية على شركات البوابة",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      return rows.length;
    });
    res.json({ updated: result, message: "اتحفظ" });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* Archive / restore (هجرة 0078)                                       */
/* الإيقاف مؤقت. الأرشفة = الشركة قررت ما تتعاملش معانا: موقوفة + مخفية  */
/* من القوايم، وكل بياناتها محفوظة وبترجع بالاسترجاع بضغطة واحدة.       */
/* ------------------------------------------------------------------ */
const archiveSchema = z.object({
  reason: z.string().max(2000),
  acknowledgeOpenOrders: z.boolean().optional().default(false),
});

router.post("/portal-companies/:id/archive", ...manage, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = id(req.params.id);
    const body = archiveSchema.parse(req.body);
    const parsed = parseArchiveReason(body.reason);
    if (!parsed.ok) throw domainError(400, "INVALID_ARCHIVE_REASON", parsed.message);

    const openOrders = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: portalCustomersTable.id,
          isActive: portalCustomersTable.isActive,
          archivedAt: portalCustomersTable.archivedAt,
        })
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, companyId))
        .for("update");
      if (!row) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الشركة مش موجودة");
      if (row.archivedAt) throw domainError(409, "COMPANY_ALREADY_ARCHIVED", "الشركة دي مؤرشفة بالفعل");

      const [{ open }] = await tx
        .select({ open: sql<number>`count(*)::int` })
        .from(productionWorkflowOrdersTable)
        .where(
          and(
            eq(productionWorkflowOrdersTable.portalCustomerId, companyId),
            notInArray(productionWorkflowOrdersTable.workflowStatus, [...FINISHED_ORDER_STATUSES]),
          ),
        );
      if (archiveNeedsOpenOrdersConfirmation(open, body.acknowledgeOpenOrders)) {
        throw domainError(
          409,
          "COMPANY_HAS_OPEN_ORDERS",
          `الشركة عندها ${open} طلب شغّال. الأرشفة هتقفل دخولها بس والطلبات هتكمل عادي — أكّد لو عايز تكمّل.`,
        );
      }

      await tx
        .update(portalCustomersTable)
        .set({
          isActive: false,
          archivedAt: new Date(),
          archivedByUserId: req.user!.userId,
          archiveReason: parsed.reason,
        })
        .where(eq(portalCustomersTable.id, companyId));
      await revokeAllPortalSessions(companyId, tx);
      await writePortalAudit(tx, {
        companyId,
        ...staffActor(req),
        action: "company.archived",
        targetType: "company",
        targetId: companyId,
        before: { isActive: row.isActive },
        after: { archived: true, reason: parsed.reason, openOrders: open },
      });
      await writeAuditEvent({
        executor: tx,
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: "portal.company.archive",
        resourceType: "portal_customer",
        resourceId: companyId,
        beforeData: { isActive: row.isActive },
        afterData: { archived: true, openOrders: open },
        reason: parsed.reason,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      return open;
    });
    res.json({ message: "اتأرشفت الشركة. بياناتها كلها محفوظة وتقدر ترجّعها في أي وقت.", openOrders });
  } catch (e) {
    next(e);
  }
});

router.post("/portal-companies/:id/restore", ...manage, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = id(req.params.id);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: portalCustomersTable.id,
          archivedAt: portalCustomersTable.archivedAt,
          archiveReason: portalCustomersTable.archiveReason,
        })
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, companyId))
        .for("update");
      if (!row) throw domainError(404, "PORTAL_CUSTOMER_NOT_FOUND", "الشركة مش موجودة");
      if (!row.archivedAt) throw domainError(409, "COMPANY_NOT_ARCHIVED", "الشركة دي مش مؤرشفة");

      await tx
        .update(portalCustomersTable)
        .set({ ...restoredCompanyFields(), archivedAt: null, archivedByUserId: null, archiveReason: null })
        .where(eq(portalCustomersTable.id, companyId));
      await writePortalAudit(tx, {
        companyId,
        ...staffActor(req),
        action: "company.restored",
        targetType: "company",
        targetId: companyId,
        before: { archivedAt: row.archivedAt, reason: row.archiveReason },
        after: { archived: false },
      });
      await writeAuditEvent({
        executor: tx,
        actorUserId: req.user!.userId,
        actorName: req.user!.username,
        actionKey: "portal.company.restore",
        resourceType: "portal_customer",
        resourceId: companyId,
        beforeData: { archivedAt: row.archivedAt, archiveReason: row.archiveReason },
        afterData: { archived: false },
        reason: "استرجاع شركة من الأرشيف",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
    });
    res.json({ message: "اترجّعت الشركة من الأرشيف. هتغيّر كلمة السر عند أول دخول." });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* Global settings (catalog + history + revert)                        */
/* ------------------------------------------------------------------ */
router.get("/portal-admin/settings", ...view, async (_req, res, next) => {
  try {
    const rows = await db
      .select({ key: portalSettingsTable.key, value: portalSettingsTable.value, updatedBy: portalSettingsTable.updatedBy, updatedAt: portalSettingsTable.updatedAt })
      .from(portalSettingsTable)
      .where(and(eq(portalSettingsTable.scope, "global"), isNull(portalSettingsTable.scopeId)));
    res.json({ catalog: describeSettings().filter((d) => d.scopes.includes("global")), values: rows });
  } catch (e) {
    next(e);
  }
});

router.put("/portal-admin/settings/:key", ...manage, async (req, res, next) => {
  try {
    const key = String(req.params.key);
    if (!getSettingDef(key)) throw domainError(400, "INVALID_SETTING", "الإعداد ده مش موجود");
    const body = z.object({ value: z.unknown().optional(), reset: z.boolean().optional() }).parse(req.body);
    await db.transaction((tx) =>
      changeSetting(tx, { scope: "global", scopeId: null, key, value: body.value, reset: body.reset, by: staffName(req) }),
    );
    res.json({ message: "اتحفظ" });
  } catch (e) {
    next(e);
  }
});

router.get("/portal-admin/settings-history", ...view, async (_req, res, next) => {
  try {
    const rows = await listSettingHistory("global", null);
    const names = await staffNames(rows.map((r) => r.changedBy));
    res.json({ items: rows.map((r) => ({ ...r, changedByName: names.get(r.changedBy) ?? r.changedBy })) });
  } catch (e) {
    next(e);
  }
});

router.post("/portal-admin/settings-history/:historyId/revert", ...manage, async (req, res, next) => {
  try {
    const key = await db.transaction((tx) =>
      revertSettingChange(tx, id(req.params.historyId), staffName(req), { scope: "global", scopeId: null }),
    );
    res.json({ message: "رجّعنا القيمة اللي قبلها", key });
  } catch (e) {
    next(e);
  }
});

async function staffNames(labels: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(labels.map((l) => /^staff:(\d+)$/.exec(l)?.[1]).filter(Boolean).map(Number))];
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: systemUsersTable.id, fullName: systemUsersTable.fullName })
    .from(systemUsersTable)
    .where(inArray(systemUsersTable.id, ids as number[]));
  return new Map(rows.map((r) => [`staff:${r.id}`, r.fullName]));
}

/* ------------------------------------------------------------------ */
/* Company detail                                                      */
/* ------------------------------------------------------------------ */
router.get("/portal-companies/:id", ...view, async (req, res, next) => {
  try {
    const companyId = id(req.params.id);
    const company = await requireCompanyRow(companyId);
    const [members, orders, code, settings, roles, sessions] = await Promise.all([
      loadTeamForStaff(companyId),
      db
        .select({ id: salesOrdersTable.id, orderNumber: salesOrdersTable.orderNumber, status: salesOrdersTable.status, createdAt: salesOrdersTable.createdAt, createdById: salesOrdersTable.createdById })
        .from(salesOrdersTable)
        .where(eq(salesOrdersTable.contactId, company.contactId))
        .orderBy(desc(salesOrdersTable.createdAt))
        .limit(10),
      getActiveCompanyCode(db, companyId),
      companySettings(companyId),
      listCompanyRoles(db, companyId),
      db
        .select({
          id: portalSessionsTable.id,
          memberId: portalSessionsTable.memberId,
          deviceLabel: portalSessionsTable.deviceLabel,
          ipAddress: portalSessionsTable.ipAddress,
          lastActiveAt: portalSessionsTable.lastActiveAt,
          createdAt: portalSessionsTable.createdAt,
        })
        .from(portalSessionsTable)
        .where(and(eq(portalSessionsTable.companyId, companyId), isNull(portalSessionsTable.revokedAt), sql`${portalSessionsTable.expiresAt} > now()`))
        .orderBy(desc(portalSessionsTable.lastActiveAt))
        .limit(100),
    ]);
    res.json({
      company,
      members,
      roles: roles.map((r) => ({ key: r.key, name: r.name, permissions: r.permissions })).filter((r) => r.key !== "owner"),
      recentOrders: orders,
      joinCode: code
        ? { code: formatCompanyCode(code.code), expiresAt: code.expiresAt, maxUses: code.maxUses, uses: code.uses }
        : null,
      settings,
      sessions,
    });
  } catch (e) {
    next(e);
  }
});

/** Every company-level setting with its effective value and where it comes from. */
async function companySettings(companyId: number) {
  const resolver = await createSettingsResolver({ companyId });
  const own = await db
    .select({ key: portalSettingsTable.key })
    .from(portalSettingsTable)
    .where(and(eq(portalSettingsTable.scope, "company"), eq(portalSettingsTable.scopeId, companyId)));
  const overridden = new Set(own.map((r) => r.key));
  return PORTAL_SETTING_DEFS.filter((d) => d.scopes.includes("company")).map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    group: d.group,
    value: resolver.get(d.key),
    source: overridden.has(d.key) ? "company" : "inherited",
    editableBy: d.editableBy,
    shape: describeShape(d.key, d.schema),
    default: d.default,
  }));
}

router.put("/portal-companies/:id/settings/:key", ...manage, async (req, res, next) => {
  try {
    const companyId = id(req.params.id);
    await requireCompanyRow(companyId);
    const key = String(req.params.key);
    if (!getSettingDef(key)) throw domainError(400, "INVALID_SETTING", "الإعداد ده مش موجود");
    const body = z.object({ value: z.unknown().optional(), reset: z.boolean().optional() }).parse(req.body);
    await db.transaction(async (tx) => {
      await changeSetting(tx, { scope: "company", scopeId: companyId, key, value: body.value, reset: body.reset, by: staffName(req) });
      await writePortalAudit(tx, { companyId, ...staffActor(req), action: "setting.changed", targetType: "setting", targetId: key, after: { value: body.reset ? "reset" : body.value } });
    });
    res.json({ message: "اتحفظ", settings: await companySettings(companyId) });
  } catch (e) {
    next(e);
  }
});

router.get("/portal-companies/:id/settings-history", ...view, async (req, res, next) => {
  try {
    const companyId = id(req.params.id);
    await requireCompanyRow(companyId);
    const rows = await listSettingHistory("company", companyId);
    const names = await staffNames(rows.map((r) => r.changedBy));
    res.json({ items: rows.map((r) => ({ ...r, changedByName: names.get(r.changedBy) ?? r.changedBy })) });
  } catch (e) {
    next(e);
  }
});

router.post("/portal-companies/:id/settings-history/:historyId/revert", ...manage, async (req, res, next) => {
  try {
    const companyId = id(req.params.id);
    await requireCompanyRow(companyId);
    const key = await db.transaction(async (tx) => {
      const k = await revertSettingChange(tx, id(req.params.historyId), staffName(req), { scope: "company", scopeId: companyId });
      await writePortalAudit(tx, { companyId, ...staffActor(req), action: "setting.reverted", targetType: "setting", targetId: k });
      return k;
    });
    res.json({ message: "رجّعنا القيمة اللي قبلها", key, settings: await companySettings(companyId) });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */
const newMemberSchema = z.object({
  fullName: z.string().trim().min(2, "الاسم مطلوب").max(100),
  phone: z.string().trim().min(8, "رقم هاتف غير صحيح").max(20),
  email: z.string().trim().email("بريد غير صحيح").optional().nullable().or(z.literal("")),
  roleKey: z.string().trim().min(1),
  title: z.string().trim().max(80).optional().nullable(),
  limits: z.record(z.string(), z.unknown()).optional(),
});

router.post("/portal-companies/:id/members", ...manage, async (req, res, next) => {
  try {
    const companyId = id(req.params.id);
    const body = newMemberSchema.parse(req.body);
    const company = await requireCompanyRow(companyId);
    const created = await db.transaction(async (tx) => {
      await tx.select({ id: portalCustomersTable.id }).from(portalCustomersTable).where(eq(portalCustomersTable.id, companyId)).for("update");
      const c = await createMemberAccount(tx, { companyId, body, joinedVia: "admin_created" });
      await writePortalAudit(tx, {
        companyId, ...staffActor(req), action: "member.created", targetType: "member", targetId: c.memberId,
        after: { fullName: body.fullName, role: c.roleKey },
      });
      return c;
    });
    const message = `أهلاً ${body.fullName}، اتضفت لحساب ${company.companyName} في Hyper-Tech.\nرقمك: ${body.phone.trim()}\nكلمة السر المؤقتة: ${created.tempPassword}\nهتغيّرها أول ما تدخل.`;
    res.status(201).json({
      memberId: created.memberId,
      tempPassword: created.tempPassword,
      whatsappUrl: buildWhatsAppLink(body.phone, message),
      message,
    });
  } catch (e) {
    next(e);
  }
});

const patchMemberSchema = z.object({
  roleKey: z.string().trim().min(1).optional(),
  title: z.string().trim().max(80).nullable().optional(),
  limits: z.record(z.string(), z.unknown()).optional(),
  overrides: z.array(z.object({ permissionKey: z.string(), effect: z.enum(["allow", "deny"]) })).max(40).optional(),
});

router.patch("/portal-companies/:id/members/:memberId", ...manage, async (req, res, next) => {
  try {
    const companyId = id(req.params.id);
    const memberId = id(req.params.memberId);
    const body = patchMemberSchema.parse(req.body);
    await db.transaction(async (tx) => {
      const target = await memberInCompany(tx, companyId, memberId);
      if (target.isOwner) throw domainError(403, "OWNER_PROTECTED", "رئيس الشركة مينفعش يتعدّل من هنا");
      const patch: Record<string, unknown> = {};
      if (body.roleKey) {
        const role = await findAssignableRole(tx, companyId, body.roleKey);
        if (!role) throw domainError(400, "INVALID_ROLE", "الدور ده مش متاح");
        patch.roleId = role.id;
      }
      if (body.title !== undefined) patch.title = body.title;
      if (body.limits !== undefined) patch.limits = sanitizeLimits(body.limits);
      if (Object.keys(patch).length) await tx.update(portalMembersTable).set(patch).where(eq(portalMembersTable.id, memberId));
      if (body.overrides) {
        const clean = body.overrides.filter((o) => isPortalPermissionKey(o.permissionKey));
        await tx.delete(portalMemberOverridesTable).where(eq(portalMemberOverridesTable.memberId, memberId));
        if (clean.length) await tx.insert(portalMemberOverridesTable).values(clean.map((o) => ({ memberId, permissionKey: o.permissionKey, effect: o.effect })));
      }
      await writePortalAudit(tx, {
        companyId, ...staffActor(req), action: "member.updated", targetType: "member", targetId: memberId,
        after: { role: body.roleKey, title: body.title, limits: body.limits ? sanitizeLimits(body.limits) : undefined, overrides: body.overrides?.length },
      });
    });
    invalidateMemberAccess(memberId);
    res.json({ message: "اتحفظ" });
  } catch (e) {
    next(e);
  }
});

router.post("/portal-companies/:id/members/:memberId/remove", ...manage, async (req, res, next) => {
  try {
    const companyId = id(req.params.id);
    const memberId = id(req.params.memberId);
    await db.transaction(async (tx) => {
      const m = await memberInCompany(tx, companyId, memberId);
      if (m.isOwner) throw domainError(403, "OWNER_PROTECTED", "رئيس الشركة مينفعش يتشال من هنا");
      if (m.status === "removed") throw domainError(409, "INVALID_STATE", "الموظف ده اتشال قبل كده");
      await tx.update(portalMembersTable).set({ status: "removed" }).where(eq(portalMembersTable.id, memberId));
      await revokeMemberSessions(memberId, tx);
      await writePortalAudit(tx, {
        companyId, ...staffActor(req), action: "member.removed", targetType: "member", targetId: memberId,
        before: { status: m.status }, after: { status: "removed" },
      });
    });
    invalidateMemberAccess(memberId);
    res.json({ message: "تمام" });
  } catch (e) {
    next(e);
  }
});

router.post("/portal-companies/:id/members/:memberId/revoke-sessions", ...manage, async (req, res, next) => {
  try {
    const companyId = id(req.params.id);
    const memberId = id(req.params.memberId);
    const count = await db.transaction(async (tx) => {
      await memberInCompany(tx, companyId, memberId);
      const n = await revokeMemberSessions(memberId, tx);
      await writePortalAudit(tx, {
        companyId, ...staffActor(req), action: "member.sessions_revoked", targetType: "member", targetId: memberId, after: { count: n },
      });
      return n;
    });
    invalidateMemberAccess(memberId);
    res.json({ revoked: count, message: "اتقفلت الجلسات" });
  } catch (e) {
    next(e);
  }
});

router.post("/portal-companies/:id/members/:memberId/reset-link", ...manage, async (req, res, next) => {
  try {
    const companyId = id(req.params.id);
    const memberId = id(req.params.memberId);
    const [m] = await db
      .select({ id: portalMembersTable.id, userId: portalMembersTable.userId, isOwner: portalMembersTable.isOwner, status: portalMembersTable.status, phone: portalUsersTable.phone })
      .from(portalMembersTable)
      .innerJoin(portalUsersTable, eq(portalUsersTable.id, portalMembersTable.userId))
      .where(and(eq(portalMembersTable.id, memberId), eq(portalMembersTable.companyId, companyId)))
      .limit(1);
    if (!m || m.status === "removed") throw domainError(404, "MEMBER_NOT_FOUND", "الموظف مش موجود");
    const ttl = await resolveSetting<number>("auth.reset.ttl_minutes", {});
    const issued = await issueAuthToken(db, {
      userId: m.userId, purpose: "password_reset", ttlMinutes: ttl, createdByStaffId: req.user!.userId,
      meta: { kind: "staff_link", companyId },
    });
    const u = new URL(buildPortalPageUrl(req, "/portal-activate.html"));
    u.searchParams.set("mode", "reset");
    u.searchParams.set("token", issued.raw);
    const url = u.toString();
    await writePortalAudit(db, { companyId, ...staffActor(req), action: "member.reset_link_issued", targetType: "member", targetId: memberId });
    res.json({
      url,
      expiresAt: issued.expiresAt,
      duration: humanDuration(ttl),
      whatsappUrl: buildWhatsAppLink(m.phone, `رابط كلمة سر جديدة (صالح ${humanDuration(ttl)}): ${url}`),
    });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* Activity log                                                        */
/* ------------------------------------------------------------------ */
const auditQuery = z.object({
  action: z.string().trim().max(60).optional(),
  memberId: z.coerce.number().int().positive().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

async function loadAudit(companyId: number, q: z.infer<typeof auditQuery>, all = false) {
  const conds = [eq(portalAuditEventsTable.companyId, companyId)];
  if (q.action) conds.push(eq(portalAuditEventsTable.action, q.action));
  if (q.memberId) conds.push(sql`(${portalAuditEventsTable.actorMemberId} = ${q.memberId} OR (${portalAuditEventsTable.targetType} = 'member' AND ${portalAuditEventsTable.targetId} = ${String(q.memberId)}))`);
  if (q.from) conds.push(sql`${portalAuditEventsTable.createdAt} >= ${q.from}::date`);
  if (q.to) conds.push(sql`${portalAuditEventsTable.createdAt} < (${q.to}::date + 1)`);
  const where = and(...conds);
  const query = db
    .select({
      id: portalAuditEventsTable.id,
      action: portalAuditEventsTable.action,
      actorLabel: portalAuditEventsTable.actorLabel,
      actorMemberId: portalAuditEventsTable.actorMemberId,
      actorStaffUserId: portalAuditEventsTable.actorStaffUserId,
      targetType: portalAuditEventsTable.targetType,
      targetId: portalAuditEventsTable.targetId,
      before: portalAuditEventsTable.before,
      after: portalAuditEventsTable.after,
      createdAt: portalAuditEventsTable.createdAt,
    })
    .from(portalAuditEventsTable)
    .where(where)
    .orderBy(desc(portalAuditEventsTable.id));
  const rows = all ? await query.limit(5000) : await query.limit(q.pageSize).offset((q.page - 1) * q.pageSize);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(portalAuditEventsTable).where(where);
  // Names for humans: members referenced as actor or target.
  const memberIds = [...new Set(rows.flatMap((r) => [r.actorMemberId, r.targetType === "member" ? Number(r.targetId) : null]).filter((x): x is number => !!x))];
  const people = memberIds.length
    ? await db
        .select({ memberId: portalMembersTable.id, fullName: portalUsersTable.fullName })
        .from(portalMembersTable)
        .innerJoin(portalUsersTable, eq(portalUsersTable.id, portalMembersTable.userId))
        .where(inArray(portalMembersTable.id, memberIds))
    : [];
  const names = new Map(people.map((p) => [p.memberId, p.fullName]));
  const staff = await staffNames(rows.map((r) => (r.actorStaffUserId ? `staff:${r.actorStaffUserId}` : "")).filter(Boolean));
  return {
    total: n,
    items: rows.map((r) => ({
      ...r,
      actorName: r.actorStaffUserId ? staff.get(`staff:${r.actorStaffUserId}`) ?? r.actorLabel : r.actorMemberId ? names.get(r.actorMemberId) ?? r.actorLabel : r.actorLabel,
      targetName: r.targetType === "member" ? names.get(Number(r.targetId)) ?? null : null,
      actorKind: r.actorStaffUserId ? "staff" : "member",
    })),
  };
}

router.get("/portal-companies/:id/audit", ...view, async (req, res, next) => {
  try {
    const companyId = id(req.params.id);
    await requireCompanyRow(companyId);
    const q = auditQuery.parse(req.query);
    const out = await loadAudit(companyId, q);
    res.json({ ...out, page: q.page, pageSize: q.pageSize });
  } catch (e) {
    next(e);
  }
});

router.get("/portal-companies/:id/audit.csv", ...view, async (req, res, next) => {
  try {
    const companyId = id(req.params.id);
    await requireCompanyRow(companyId);
    const q = auditQuery.parse(req.query);
    const { items } = await loadAudit(companyId, q, true);
    const rows: unknown[][] = [
      ["الوقت", "الحدث", "اللي عمله", "الموظف المعني", "قبل", "بعد"],
      ...items.map((r) => [
        new Date(r.createdAt).toISOString(), r.action, r.actorName, r.targetName ?? "",
        r.before ? JSON.stringify(r.before) : "", r.after ? JSON.stringify(r.after) : "",
      ]),
    ];
    res
      .status(200)
      .setHeader("Content-Type", "text/csv; charset=utf-8")
      .setHeader("Content-Disposition", `attachment; filename="company-${companyId}-activity.csv"`)
      .send(toCsv(rows));
  } catch (e) {
    next(e);
  }
});

export default router;
