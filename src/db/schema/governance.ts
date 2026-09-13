import {
  pgTable, serial, integer, text, numeric, boolean, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { systemUsersTable } from "./settings";

export const delegationsTable = pgTable("delegations", {
  id: serial("id").primaryKey(),
  grantorUserId: integer("grantor_user_id").notNull().references(() => systemUsersTable.id),
  delegateUserId: integer("delegate_user_id").notNull().references(() => systemUsersTable.id),
  actionKey: text("action_key").notNull(),
  scopeType: text("scope_type").notNull().default("company"),
  scopeId: text("scope_id"),
  maxAmount: numeric("max_amount", { precision: 14, scale: 2 }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: integer("revoked_by").references(() => systemUsersTable.id),
}, (table) => ({
  delegateActionIdx: index("delegations_delegate_action_idx").on(table.delegateUserId, table.actionKey),
  activeWindowIdx: index("delegations_active_window_idx").on(table.status, table.startsAt, table.endsAt),
}));

export const sodRulesTable = pgTable("sod_rules", {
  id: serial("id").primaryKey(),
  actionKeyCreate: text("action_key_create").notNull(),
  actionKeyApprove: text("action_key_approve").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const approvalPoliciesTable = pgTable("approval_policies", {
  id: serial("id").primaryKey(),
  actionKey: text("action_key").notNull(),
  minAmount: numeric("min_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  approverRoles: jsonb("approver_roles").$type<string[]>().notNull().default([]),
  sequence: integer("sequence").notNull().default(1),
  requiredApprovals: integer("required_approvals").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  policyLookupIdx: index("approval_policies_lookup_idx").on(table.actionKey, table.minAmount, table.active),
}));

export const approvalRequestsTable = pgTable("approval_requests", {
  id: serial("id").primaryKey(),
  actionKey: text("action_key").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: integer("resource_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  requestedBy: integer("requested_by").notNull().references(() => systemUsersTable.id),
  status: text("status").notNull().default("pending"),
  currentStep: integer("current_step").notNull().default(1),
  metadata: jsonb("metadata"),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (table) => ({
  resourceIdx: index("approval_requests_resource_idx").on(table.resourceType, table.resourceId),
  pendingIdx: index("approval_requests_pending_idx").on(table.status, table.actionKey),
}));

export const auditEventsTable = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actor_user_id").references(() => systemUsersTable.id, { onDelete: "set null" }),
  actorName: text("actor_name"),
  actionKey: text("action_key").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: integer("resource_id"),
  beforeData: jsonb("before_data"),
  afterData: jsonb("after_data"),
  decision: text("decision").notNull().default("executed"),
  reason: text("reason"),
  delegationId: integer("delegation_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  prevHash: text("prev_hash"),
  recordHash: text("record_hash").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  resourceAuditIdx: index("audit_events_resource_idx").on(table.resourceType, table.resourceId),
  actorAuditIdx: index("audit_events_actor_idx").on(table.actorUserId, table.createdAt),
}));

export const createDelegationSchema = z.object({
  grantorUserId: z.number().int().positive(),
  delegateUserId: z.number().int().positive(),
  actionKey: z.string().min(1).max(120),
  scopeType: z.enum(["company", "factory", "branch", "warehouse", "department", "production_line", "document"]),
  scopeId: z.string().max(120).optional().nullable(),
  maxAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.string().min(3).max(500),
}).refine((v) => v.grantorUserId !== v.delegateUserId, { message: "لا يمكن تفويض المستخدم لنفسه" })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: "نهاية التفويض يجب أن تكون بعد بدايته" });

export type Delegation = typeof delegationsTable.$inferSelect;