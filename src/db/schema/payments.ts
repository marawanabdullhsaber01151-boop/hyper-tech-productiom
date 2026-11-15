/** @format */
// تحصيلات العملاء وتخصيصها على الفواتير (50). الضمانات (مجموع التخصيص، عدم التعديل) في ترجرات هجرة 0103.
import { pgTable, serial, integer, text, numeric, date, timestamp, index } from "drizzle-orm/pg-core";

export const customerPaymentsTable = pgTable(
  "customer_payments",
  {
    id: serial("id").primaryKey(),
    paymentNumber: text("payment_number").notNull().unique(),
    contactId: integer("contact_id").notNull(),
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    method: text("method").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    reference: text("reference"),
    notes: text("notes"),
    status: text("status").notNull().default("posted"),
    journalEntryId: integer("journal_entry_id"),
    voidReason: text("void_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByName: text("voided_by_name"),
    createdBy: integer("created_by"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ contactIdx: index("customer_payments_contact_idx").on(t.contactId, t.paymentDate) }),
);

export const paymentAllocationsTable = pgTable(
  "payment_allocations",
  {
    id: serial("id").primaryKey(),
    paymentId: integer("payment_id").notNull(),
    salesOrderId: integer("sales_order_id").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ paymentIdx: index("payment_allocations_payment_idx").on(t.paymentId), orderIdx: index("payment_allocations_order_idx").on(t.salesOrderId) }),
);
