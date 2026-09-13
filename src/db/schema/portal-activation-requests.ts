/** @format */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { contactsTable } from "./contacts";
import { portalCustomersTable } from "./portal-customers";
import { systemUsersTable } from "./settings";

export const portalActivationRequestStatuses = [
  "pending",
  "confirmed",
  "rejected",
] as const;

export const portalActivationRequestsTable = pgTable(
  "portal_activation_requests",
  {
    id: serial("id").primaryKey(),
    companyNameEntered: text("company_name_entered").notNull(),
    normalizedCompanyName: text("normalized_company_name"),
    phoneEntered: text("phone_entered").notNull(),
    normalizedPhone: text("normalized_phone"),
    matchedContactId: integer("matched_contact_id").references(
      () => contactsTable.id,
      { onDelete: "set null" },
    ),
    matchedPortalCustomerId: integer("matched_portal_customer_id").references(
      () => portalCustomersTable.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("pending"),
    decidedByUserId: integer("decided_by_user_id").references(
      () => systemUsersTable.id,
      { onDelete: "set null" },
    ),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    phoneIdx: index("portal_activation_requests_phone_idx").on(
      table.phoneEntered,
    ),
    statusIdx: index("portal_activation_requests_status_idx").on(table.status),
  }),
);

export type PortalActivationRequest =
  typeof portalActivationRequestsTable.$inferSelect;