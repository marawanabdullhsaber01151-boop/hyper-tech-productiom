/** @format */
// تأكيد الأرصدة (53ب). الضمانات (حالات، انتقالات، قفل اللقطة، طلب مفتوح واحد لكل عميل) في هجرة 0106.
import { pgTable, serial, integer, text, numeric, date, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const balanceConfirmationsTable = pgTable(
  "balance_confirmations",
  {
    id: serial("id").primaryKey(),
    confirmationNumber: text("confirmation_number").notNull().unique(),
    contactId: integer("contact_id").notNull(),
    portalCustomerId: integer("portal_customer_id").notNull(),
    asOf: date("as_of", { mode: "string" }).notNull(),
    balance: numeric("balance", { precision: 14, scale: 2 }).notNull(),
    periodFrom: date("period_from", { mode: "string" }).notNull(),
    opening: numeric("opening", { precision: 14, scale: 2 }).notNull(),
    lines: jsonb("lines").notNull().default([]),
    note: text("note"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    requestedBy: integer("requested_by"),
    requestedByName: text("requested_by_name").notNull(),
    status: text("status").notNull().default("open"),
    respondedByMemberId: integer("responded_by_member_id"),
    respondedByName: text("responded_by_name"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    customerAmount: numeric("customer_amount", { precision: 14, scale: 2 }),
    customerNote: text("customer_note"),
    taskId: integer("task_id"),
    resolutionNote: text("resolution_note"),
    resolvedBy: integer("resolved_by"),
    resolvedByName: text("resolved_by_name"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ companyIdx: index("balance_conf_company_idx").on(t.portalCustomerId, t.createdAt), statusIdx: index("balance_conf_status_idx").on(t.status, t.dueDate) }),
);
