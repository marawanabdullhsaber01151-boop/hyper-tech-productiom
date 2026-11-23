/** @format */
// إبلاغ العميل عن تحويل (53أ). الضمانات (حالة، شكل المؤكَّد/المرفوض، عدم التكرار، عدم التعديل بعد القرار) في هجرة 0105.
import { pgTable, serial, integer, text, numeric, date, timestamp, index } from "drizzle-orm/pg-core";

export const customerTransferReportsTable = pgTable(
  "customer_transfer_reports",
  {
    id: serial("id").primaryKey(),
    reportNumber: text("report_number").notNull().unique(),
    contactId: integer("contact_id").notNull(),
    portalCustomerId: integer("portal_customer_id").notNull(),
    reportedByMemberId: integer("reported_by_member_id"),
    reportedByName: text("reported_by_name").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    transferDate: date("transfer_date", { mode: "string" }).notNull(),
    method: text("method").notNull(),
    reference: text("reference").notNull(),
    note: text("note"),
    status: text("status").notNull().default("pending"),
    taskId: integer("task_id"),
    paymentId: integer("payment_id"),
    confirmedAmount: numeric("confirmed_amount", { precision: 14, scale: 2 }),
    reviewNote: text("review_note"),
    rejectReason: text("reject_reason"),
    reviewedBy: integer("reviewed_by"),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ companyIdx: index("transfer_reports_company_idx").on(t.portalCustomerId, t.createdAt), statusIdx: index("transfer_reports_status_idx").on(t.status, t.createdAt) }),
);
