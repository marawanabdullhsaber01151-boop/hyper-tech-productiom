/** @format */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { portalCustomersTable } from "./portal-customers";

export const portalOtpCodesTable = pgTable(
  "portal_otp_codes",
  {
    id: serial("id").primaryKey(),
    portalCustomerId: integer("portal_customer_id")
      .notNull()
      .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // phone | email
    codeHash: text("code_hash").notNull(),
    purpose: text("purpose").notNull().default("password_reset"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    customerPurposeIdx: index("portal_otp_customer_purpose_idx").on(
      table.portalCustomerId,
      table.purpose,
      table.createdAt,
    ),
    expiryIdx: index("portal_otp_expiry_idx").on(table.expiresAt),
  }),
);

export const portalNotificationsTable = pgTable(
  "portal_notifications",
  {
    id: serial("id").primaryKey(),
    portalCustomerId: integer("portal_customer_id")
      .notNull()
      .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    referenceType: text("reference_type")
      .notNull()
      .default("production_workflow"),
    referenceId: integer("reference_id"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    customerReadIdx: index("portal_notifications_customer_read_idx").on(
      table.portalCustomerId,
      table.isRead,
    ),
    customerCreatedIdx: index("portal_notifications_customer_created_idx").on(
      table.portalCustomerId,
      table.createdAt,
    ),
  }),
);

export type PortalOtpCode = typeof portalOtpCodesTable.$inferSelect;
export type PortalNotification = typeof portalNotificationsTable.$inferSelect;