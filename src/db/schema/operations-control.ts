import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  boolean,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod";

export const fulfillmentAllocationsTable = pgTable(
  "fulfillment_allocations",
  {
    id: serial("id").primaryKey(),
    salesOrderId: integer("sales_order_id").notNull(),
    salesOrderItemId: integer("sales_order_item_id").notNull(),
    sourceType: text("source_type").notNull(), // stock | production | purchase
    sourceId: integer("source_id"),
    inventoryItemId: integer("inventory_item_id"),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    status: text("status").notNull().default("planned"),
    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orderIdx: index("fulfillment_allocations_order_idx").on(table.salesOrderId),
    sourceIdx: index("fulfillment_allocations_source_idx").on(table.sourceType, table.sourceId),
    uniqueSource: unique("fulfillment_allocations_item_source_unique").on(
      table.salesOrderItemId,
      table.sourceType,
      table.sourceId,
    ),
  }),
);

export const purchaseRequisitionsTable = pgTable(
  "purchase_requisitions",
  {
    id: serial("id").primaryKey(),
    salesOrderId: integer("sales_order_id"),
    workflowOrderId: integer("workflow_order_id"),
    inventoryItemId: integer("inventory_item_id"),
    materialName: text("material_name").notNull(),
    requiredQty: numeric("required_qty", { precision: 14, scale: 3 }).notNull(),
    availableQty: numeric("available_qty", { precision: 14, scale: 3 }).notNull().default("0"),
    shortageQty: numeric("shortage_qty", { precision: 14, scale: 3 }).notNull(),
    status: text("status").notNull().default("pending_operations"),
    reason: text("reason").notNull(),
    confirmedBy: integer("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workflowIdx: index("purchase_requisitions_workflow_idx").on(table.workflowOrderId, table.status),
    itemIdx: index("purchase_requisitions_item_idx").on(table.inventoryItemId),
    uniqueNeed: unique("purchase_requisitions_workflow_item_unique").on(
      table.workflowOrderId,
      table.inventoryItemId,
      table.materialName,
    ),
  }),
);

export const operationTransfersTable = pgTable(
  "operation_transfers",
  {
    id: serial("id").primaryKey(),
    workflowOrderId: integer("workflow_order_id").notNull(),
    direction: text("direction").notNull(), // warehouse_to_operations | operations_to_production | production_to_operations | operations_to_warehouse
    inventoryItemId: integer("inventory_item_id"),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    status: text("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    preparedBy: integer("prepared_by").notNull(),
    receivedBy: integer("received_by"),
    preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull().defaultNow(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    notes: text("notes"),
  },
  (table) => ({
    workflowIdx: index("operation_transfers_workflow_idx").on(table.workflowOrderId, table.status),
  }),
);

export const workflowEventsTable = pgTable(
  "workflow_events",
  {
    id: serial("id").primaryKey(),
    workflowOrderId: integer("workflow_order_id").notNull(),
    internalStatus: text("internal_status").notNull(),
    customerStatus: text("customer_status"),
    actorUserId: integer("actor_user_id"),
    actorName: text("actor_name"),
    automatic: boolean("automatic").notNull().default(false),
    cause: text("cause"),
    details: text("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workflowIdx: index("workflow_events_workflow_idx").on(table.workflowOrderId, table.createdAt),
  }),
);

export const operationTransferSchema = z.object({
  workflowOrderId: z.number().int().positive(),
  direction: z.enum([
    "warehouse_to_operations",
    "operations_to_production",
    "production_to_operations",
    "operations_to_warehouse",
  ]),
  inventoryItemId: z.number().int().positive().optional().nullable(),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
  idempotencyKey: z.string().min(8).max(150),
  notes: z.string().max(500).optional().nullable(),
});

export type FulfillmentAllocation = typeof fulfillmentAllocationsTable.$inferSelect;
export type PurchaseRequisition = typeof purchaseRequisitionsTable.$inferSelect;
export type OperationTransfer = typeof operationTransfersTable.$inferSelect;
export type WorkflowEvent = typeof workflowEventsTable.$inferSelect;