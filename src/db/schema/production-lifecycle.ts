import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { productionWorkflowOrdersTable } from "./production-workflow";

export const productionTransitionEventsTable = pgTable(
  "production_transition_events",
  {
    id: serial("id").primaryKey(),
    workflowOrderId: integer("workflow_order_id")
      .notNull()
      .references(() => productionWorkflowOrdersTable.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actionKey: text("action_key").notNull(),
    actorUserId: integer("actor_user_id"),
    actorName: text("actor_name"),
    reason: text("reason"),
    source: text("source").notNull().default("api"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orderRevisionUnique: unique(
      "production_transition_events_order_revision_unique",
    ).on(table.workflowOrderId, table.revision),
    orderCreatedIdx: index("production_transition_events_order_created_idx").on(
      table.workflowOrderId,
      table.createdAt,
    ),
  }),
);

export const productionLegacyOrderMappingsTable = pgTable(
  "production_legacy_order_mappings",
  {
    id: serial("id").primaryKey(),
    legacyProductionOrderId: integer("legacy_production_order_id").notNull(),
    canonicalWorkflowOrderId: integer("canonical_workflow_order_id").references(
      () => productionWorkflowOrdersTable.id,
      { onDelete: "set null" },
    ),
    mappingStatus: text("mapping_status").notNull().default("quarantined"),
    evidence: jsonb("evidence"),
    legacySnapshot: jsonb("legacy_snapshot"),
    reviewReason: text("review_reason"),
    reviewedById: integer("reviewed_by_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    legacyUnique: unique("production_legacy_order_mappings_legacy_unique").on(
      table.legacyProductionOrderId,
    ),
    mappingStatusIdx: index("production_legacy_order_mappings_status_idx").on(
      table.mappingStatus,
    ),
  }),
);

export type ProductionTransitionEvent =
  typeof productionTransitionEventsTable.$inferSelect;
export type ProductionLegacyOrderMapping =
  typeof productionLegacyOrderMappingsTable.$inferSelect;