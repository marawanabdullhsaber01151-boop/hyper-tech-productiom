/** @format */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { systemUsersTable } from "./settings";

export const portalApplicationStatuses = [
  "pending",
  "needs_info",
  "approved",
  "rejected",
] as const;

export const portalApplicationsTable = pgTable(
  "portal_applications",
  {
    id: serial("id").primaryKey(),
    referenceCode: text("reference_code").notNull().unique(),
    fullName: text("full_name").notNull(),
    companyName: text("company_name").notNull(),
    normalizedCompanyName: text("normalized_company_name"),
    phone: text("phone").notNull(),
    normalizedPhone: text("normalized_phone"),
    email: text("email"),
    normalizedEmail: text("normalized_email"),
    address: text("address").notNull(),
    city: text("city"),
    commercialRegisterNo: text("commercial_register_no"),
    taxId: text("tax_id"),
    expectedMonthlyVolume: text("expected_monthly_volume"),
    notes: text("notes"),
    status: text("status").notNull().default("pending"),
    reviewerNote: text("reviewer_note"),
    reviewedByUserId: integer("reviewed_by_user_id").references(
      () => systemUsersTable.id,
      { onDelete: "set null" },
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    phoneIdx: index("portal_applications_phone_idx").on(table.phone),
    referenceCodeIdx: index("portal_applications_reference_code_idx").on(
      table.referenceCode,
    ),
  }),
);

export type PortalApplication = typeof portalApplicationsTable.$inferSelect;