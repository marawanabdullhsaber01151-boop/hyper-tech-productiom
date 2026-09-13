/** @format */

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { portalCustomersTable } from "./portal-customers";

/**
 * Durable idempotency record for a customer portal order submission.
 *
 * The response is written in the same transaction as the production orders.
 * A concurrent retry therefore waits for the first transaction and replays
 * the committed response instead of creating another batch.
 */
export const portalOrderBatchesTable = pgTable(
  "portal_order_batches",
  {
    id: serial("id").primaryKey(),
    portalCustomerId: integer("portal_customer_id")
      .notNull()
      .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    batchRef: text("batch_ref").notNull().unique(),
    responsePayload: jsonb("response_payload"),
    responseStatus: integer("response_status").notNull().default(201),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    customerIdempotencyUnique: unique(
      "portal_order_batches_customer_idempotency_key_unique",
    ).on(table.portalCustomerId, table.idempotencyKey),
    customerCreatedAtIdx: index("portal_order_batches_customer_created_at_idx").on(
      table.portalCustomerId,
      table.createdAt,
    ),
  }),
);

export type PortalOrderBatch = typeof portalOrderBatchesTable.$inferSelect;