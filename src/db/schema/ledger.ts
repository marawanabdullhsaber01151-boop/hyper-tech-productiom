/** @format */
// دفتر الأستاذ مزدوج القيد (48). الضمانات الأساسية (توازن، فترة مقفولة، عدم التعديل) في ترجرات هجرة 0100.
import { pgTable, serial, integer, text, numeric, date, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { systemUsersTable } from "./settings";

export const glAccountsTable = pgTable("gl_accounts", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  normalSide: text("normal_side").notNull(),
  parentId: integer("parent_id"),
  isPostable: boolean("is_postable").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const glPeriodsTable = pgTable("gl_periods", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }).notNull(),
  status: text("status").notNull().default("open"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedByName: text("closed_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const glJournalEntriesTable = pgTable(
  "gl_journal_entries",
  {
    id: serial("id").primaryKey(),
    entryNumber: text("entry_number").notNull().unique(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    periodId: integer("period_id").notNull().references(() => glPeriodsTable.id),
    description: text("description").notNull(),
    sourceType: text("source_type").notNull().default("manual"),
    sourceId: text("source_id"),
    status: text("status").notNull().default("posted"),
    reversalOf: integer("reversal_of"),
    total: numeric("total", { precision: 14, scale: 2 }).notNull(),
    createdBy: integer("created_by").references(() => systemUsersTable.id, { onDelete: "set null" }),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ dateIdx: index("gl_entries_date_idx").on(t.entryDate, t.id) }),
);

export const glJournalLinesTable = pgTable(
  "gl_journal_lines",
  {
    id: serial("id").primaryKey(),
    entryId: integer("entry_id").notNull().references(() => glJournalEntriesTable.id),
    lineNo: integer("line_no").notNull(),
    accountId: integer("account_id").notNull().references(() => glAccountsTable.id),
    debit: numeric("debit", { precision: 14, scale: 2 }).notNull().default("0"),
    credit: numeric("credit", { precision: 14, scale: 2 }).notNull().default("0"),
    memo: text("memo"),
  },
  (t) => ({ accountIdx: index("gl_lines_account_idx").on(t.accountId, t.entryId) }),
);
