import { pgTable, serial, integer, text, numeric, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { z } from "zod";
import { productionWorkflowOrdersTable } from "./production-workflow";
import { systemUsersTable } from "./settings";

export const productionBatchesTable = pgTable("production_batches", {
  id: serial("id").primaryKey(),
  workflowOrderId: integer("workflow_order_id").notNull().references(() => productionWorkflowOrdersTable.id),
  batchNumber: text("batch_number").notNull().unique(),
  plannedQty: numeric("planned_qty", { precision: 14, scale: 3 }).notNull(),
  producedQty: numeric("produced_qty", { precision: 14, scale: 3 }).notNull().default("0"),
  acceptedQty: numeric("accepted_qty", { precision: 14, scale: 3 }).notNull().default("0"),
  reworkQty: numeric("rework_qty", { precision: 14, scale: 3 }).notNull().default("0"),
  scrapQty: numeric("scrap_qty", { precision: 14, scale: 3 }).notNull().default("0"),
  stage: text("stage").notNull().default("manufacturing"),
  status: text("status").notNull().default("open"),
  scrapReason: text("scrap_reason"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdBy: integer("created_by").notNull().references(() => systemUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orderIdx: index("production_batches_order_idx").on(table.workflowOrderId, table.status),
}));

export const productionCostEntriesTable = pgTable("production_cost_entries", {
  id: serial("id").primaryKey(),
  workflowOrderId: integer("workflow_order_id").notNull().references(() => productionWorkflowOrdersTable.id),
  batchId: integer("batch_id").references(() => productionBatchesTable.id),
  costType: text("cost_type").notNull(), // material / labor / machine / energy / overhead / rework / scrap
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3 }),
  unitRate: numeric("unit_rate", { precision: 14, scale: 4 }),
  sourceType: text("source_type"), // stock_movement / attendance / machine / accounting / manual
  sourceId: integer("source_id"),
  note: text("note"),
  status: text("status").notNull().default("approved"),
  createdBy: integer("created_by").notNull().references(() => systemUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orderTypeIdx: index("production_cost_entries_order_type_idx").on(table.workflowOrderId, table.costType),
}));

export const productionExceptionsTable = pgTable("production_exceptions", {
  id: serial("id").primaryKey(),
  exceptionType: text("exception_type").notNull(), // scrap_variance / material_variance / quality / delay / machine
  severity: text("severity").notNull().default("warning"),
  resourceType: text("resource_type").notNull(),
  resourceId: integer("resource_id").notNull(),
  title: text("title").notNull(),
  details: jsonb("details"),
  status: text("status").notNull().default("open"),
  assignedTo: integer("assigned_to").references(() => systemUsersTable.id),
  rootCause: text("root_cause"),
  resolution: text("resolution"),
  createdBy: integer("created_by").notNull().references(() => systemUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: integer("resolved_by").references(() => systemUsersTable.id),
}, (table) => ({
  queueIdx: index("production_exceptions_queue_idx").on(table.status, table.severity, table.createdAt),
  resourceIdx: index("production_exceptions_resource_idx").on(table.resourceType, table.resourceId),
}));

export const documentRevisionsTable = pgTable("document_revisions", {
  id: serial("id").primaryKey(),
  resourceType: text("resource_type").notNull(),
  resourceId: integer("resource_id").notNull(),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  changeReason: text("change_reason").notNull(),
  changedBy: integer("changed_by").notNull().references(() => systemUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  documentVersionIdx: index("document_revisions_document_idx").on(table.resourceType, table.resourceId, table.version),
}));

export const createBatchSchema = z.object({
  workflowOrderId: z.number().int().positive(),
  batchNumber: z.string().min(1).max(80).optional(),
  plannedQty: z.string().regex(/^\d+(\.\d{1,3})?$/),
  stage: z.string().min(1).max(80).default("manufacturing"),
});

export const createCostEntrySchema = z.object({
  workflowOrderId: z.number().int().positive(),
  batchId: z.number().int().positive().optional().nullable(),
  costType: z.enum(["material", "labor", "machine", "energy", "overhead", "rework", "scrap"]),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  quantity: z.string().optional().nullable(),
  unitRate: z.string().optional().nullable(),
  sourceType: z.string().max(80).optional().nullable(),
  sourceId: z.number().int().positive().optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

export type ProductionBatch = typeof productionBatchesTable.$inferSelect;