/** @format */

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { portalCustomersTable } from "./portal-customers";

export const portalSessionsTable = pgTable(
  "portal_sessions",
  {
    id: serial("id").primaryKey(),
    portalCustomerId: integer("portal_customer_id")
      .notNull()
      .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
    sessionToken: text("session_token").notNull().unique(),
    rememberMe: boolean("remember_me").notNull().default(false),
    deviceLabel: text("device_label"),
    ipAddress: text("ip_address"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    customerIdx: index("portal_sessions_customer_idx").on(
      table.portalCustomerId,
    ),
    expiryIdx: index("portal_sessions_expiry_idx").on(table.expiresAt),
  }),
);

export type PortalSession = typeof portalSessionsTable.$inferSelect;