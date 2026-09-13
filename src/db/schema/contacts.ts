/** @format */

import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod";

export const EGYPT_GOVERNORATES = [
  "القاهرة",
  "الجيزة",
  "القليوبية",
  "الإسكندرية",
  "البحيرة",
  "مطروح",
  "كفر الشيخ",
  "الدقهلية",
  "دمياط",
  "الشرقية",
  "بورسعيد",
  "الإسماعيلية",
  "السويس",
  "شمال سيناء",
  "جنوب سيناء",
  "الغربية",
  "المنوفية",
  "الفيوم",
  "بني سويف",
  "المنيا",
  "أسيوط",
  "سوهاج",
  "قنا",
  "الأقصر",
  "أسوان",
  "البحر الأحمر",
  "الوادي الجديد",
] as const;

export const egyptGovernorateSchema = z.enum(EGYPT_GOVERNORATES);
export const CONTACT_SEGMENTS = ["new", "standard", "preferred", "strategic"] as const;
export const contactSegmentSchema = z.enum(CONTACT_SEGMENTS);

export const contactsTable = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    ownerUserId: integer("owner_user_id"),
    type: text("type").notNull().default("customer"),
    name: text("name").notNull(),
    company: text("company"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    city: text("city"),
    // تصنيف اختياري مبدئي؛ لا يغيّر التسعير أو الحد الائتماني قبل بناء سياسة مستقلة.
    segment: text("segment"),
    balance: numeric("balance", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    // ✨ إضافة قوية: حد ائتماني اختياري للعملاء — فاضي (null) يعني مفيش حد أقصى
    creditLimit: numeric("credit_limit", { precision: 12, scale: 2 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // ✅ indexes للبحث بالنوع والاسم
  (table) => ({
    typeIdx: index("contacts_type_idx").on(table.type),
    nameIdx: index("contacts_name_idx").on(table.name),
  }),
);

// Phase 2: contactLedgerTable (the accounts-receivable ledger) was removed
// along with src/lib/contactBalance.ts — this system carries no accounting
// logic. See migrations/<new>_drop_accounting_hr_purchases.sql for the
// corresponding DB-level drop of the contact_ledger table. The `balance`
// and `creditLimit` columns on contactsTable above are left in place as
// inert/historical columns (nothing in the app writes to them anymore);
// whether to drop them too is flagged as an open question in
// CHANGE-MANIFEST-PHASE-2.md.

export const insertContactSchema = z.object({
  type: z.enum(["supplier", "customer", "both"]).default("customer"),
  ownerUserId: z.number().int().positive().optional().nullable(),
  name: z.string().min(1, "الاسم مطلوب"),
  company: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: egyptGovernorateSchema.optional().nullable(),
  segment: contactSegmentSchema.optional().nullable(),
  creditLimit: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Phase 2: createContactSchema no longer extends with openingBalance/
// openingBalanceNote — the contact-balance/credit-ledger feature (and its
// "manual opening balance" entry point) was removed along with all other
// accounting logic in this system.
export const createContactSchema = insertContactSchema;

export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;
export type ContactLedgerEntry = typeof contactLedgerTable.$inferSelect;
