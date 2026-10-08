/** @format */
/**
 * Plan 02 — multi-user identity.
 *
 *  portal_customers  == the COMPANY (kept as the physical table so every
 *                       existing FK keeps working; company id = old customer id)
 *  portal_users      == the PERSON (one login)
 *  portal_members    == membership of a person in a company (role, limits)
 *
 * Contract phase (later plan): rename portal_customers and drop its legacy
 * credential columns once everything reads from portal_users.
 */
import {
  pgTable,
  serial,
  bigserial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { portalCustomersTable } from "./portal-customers";

/** Documentation alias: a "company" is a row of portal_customers. */
export const portalCompaniesTable = portalCustomersTable;
export type PortalCompany = typeof portalCustomersTable.$inferSelect;

export const portalUsersTable = pgTable(
  "portal_users",
  {
    id: serial("id").primaryKey(),
    phone: text("phone").notNull(),
    normalizedPhone: text("normalized_phone").notNull(),
    email: text("email"),
    normalizedEmail: text("normalized_email"),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    status: text("status").notNull().default("active"), // active | disabled
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    locale: text("locale").notNull().default("ar"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    phoneUnique: uniqueIndex("portal_users_normalized_phone_unique").on(t.normalizedPhone),
    emailUnique: uniqueIndex("portal_users_normalized_email_unique")
      .on(t.normalizedEmail)
      .where(sql`${t.normalizedEmail} IS NOT NULL`),
  }),
);

export const portalRolesTable = pgTable(
  "portal_roles",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").references(() => portalCustomersTable.id, {
      onDelete: "cascade",
    }), // null = system template
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    permissions: text("permissions").array().notNull().default(sql`'{}'`),
    isSystem: boolean("is_system").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyKeyUnique: uniqueIndex("portal_roles_company_key_unique").on(
      sql`COALESCE(${t.companyId}, 0)`,
      t.key,
    ),
  }),
);

export const portalMemberStatuses = [
  "invited",
  "pending_approval",
  "active",
  "suspended",
  "removed",
] as const;
export type PortalMemberStatus = (typeof portalMemberStatuses)[number];

export const portalJoinedVia = [
  "owner_created",
  "admin_created",
  "company_code",
  "invite",
  "migration",
] as const;
export type PortalJoinedVia = (typeof portalJoinedVia)[number];

export type PortalMemberLimits = {
  maxQtyPerLine?: number;
  maxLinesPerOrder?: number;
  maxOrdersPerDay?: number;
  maxOrderValue?: number;
};

export const portalMembersTable = pgTable(
  "portal_members",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => portalUsersTable.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => portalRolesTable.id),
    status: text("status").notNull().default("active"),
    isOwner: boolean("is_owner").notNull().default(false),
    limits: jsonb("limits").$type<PortalMemberLimits>().notNull().default(sql`'{}'::jsonb`),
    joinedVia: text("joined_via").notNull().default("owner_created"),
    invitedByMemberId: integer("invited_by_member_id"),
    approvedByMemberId: integer("approved_by_member_id"),
    approvedByStaffId: integer("approved_by_staff_id"),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  },
  (t) => ({
    companyUser: uniqueIndex("portal_members_company_user_unique").on(t.companyId, t.userId),
    companyStatus: index("portal_members_company_status_idx").on(t.companyId, t.status),
    userIdx: index("portal_members_user_idx").on(t.userId),
  }),
);

export const portalMemberOverridesTable = pgTable(
  "portal_member_overrides",
  {
    memberId: integer("member_id")
      .notNull()
      .references(() => portalMembersTable.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(),
    effect: text("effect").notNull(), // allow | deny
  },
  (t) => ({ pk: primaryKey({ columns: [t.memberId, t.permissionKey] }) }),
);

export const portalCompanyCodesTable = pgTable(
  "portal_company_codes",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    status: text("status").notNull().default("active"), // active | revoked
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    createdByMemberId: integer("created_by_member_id"),
    createdByStaffId: integer("created_by_staff_id"),
    revokeReason: text("revoke_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    codeUnique: uniqueIndex("portal_company_codes_code_unique").on(t.code),
  }),
);

export const portalSettingsTable = pgTable(
  "portal_settings",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(), // global | company | member
    scopeId: integer("scope_id"),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeKey: uniqueIndex("portal_settings_scope_key_unique").on(
      t.scope,
      sql`COALESCE(${t.scopeId}, 0)`,
      t.key,
    ),
  }),
);

export const portalAuditEventsTable = pgTable(
  "portal_audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: integer("company_id").notNull(),
    actorMemberId: integer("actor_member_id"),
    actorStaffUserId: integer("actor_staff_user_id"),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyCreated: index("portal_audit_company_created_idx").on(t.companyId, t.createdAt),
    actorCreated: index("portal_audit_actor_created_idx").on(t.actorMemberId, t.createdAt),
  }),
);

export type PortalUser = typeof portalUsersTable.$inferSelect;
export type PortalRole = typeof portalRolesTable.$inferSelect;
export type PortalMember = typeof portalMembersTable.$inferSelect;
