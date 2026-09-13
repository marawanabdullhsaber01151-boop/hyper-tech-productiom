/** @format */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { portalCustomersTable } from "./portal-customers";

export const portalActivationTokenPurposes = ["first_activation"] as const;

export const portalActivationTokensTable = pgTable(
  "portal_activation_tokens",
  {
    id: serial("id").primaryKey(),
    portalCustomerId: integer("portal_customer_id")
      .notNull()
      .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose").notNull().default("first_activation"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    customerIdx: index("portal_activation_tokens_customer_idx").on(
      table.portalCustomerId,
    ),
    expiryIdx: index("portal_activation_tokens_expiry_idx").on(
      table.expiresAt,
    ),
  }),
);

export type PortalActivationToken =
  typeof portalActivationTokensTable.$inferSelect;