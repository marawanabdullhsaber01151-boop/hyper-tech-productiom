/** @format */

import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod";
import { productionBatchesTable } from "./operations";
import { productionWorkflowOrdersTable } from "./production-workflow";
import { systemUsersTable } from "./settings";
import { foundationMachinesTable } from "./foundation";

export const productionDowntimesTable = pgTable(
  "production_downtimes",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull().references(() => productionBatchesTable.id),
    workflowOrderId: integer("workflow_order_id").notNull().references(() => productionWorkflowOrdersTable.id),
    reasonCode: text("reason_code").notNull(),
    minutes: integer("minutes").notNull(),
    notes: text("notes"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    recordedBy: integer("recorded_by").notNull().references(() => systemUsersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    batchIdx: index("production_downtimes_batch_idx").on(table.batchId, table.createdAt),
    reasonIdx: index("production_downtimes_reason_idx").on(table.reasonCode),
  }),
);

export const productionOperationConfirmationsTable = pgTable(
  "production_operation_confirmations",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull().references(() => productionBatchesTable.id),
    workflowOrderId: integer("workflow_order_id").notNull().references(() => productionWorkflowOrdersTable.id),
    operationNo: integer("operation_no").notNull(),
    // Phase 4: was a bare integer with no foreign key; now linked to the
    // Foundation machine register.
    machineId: integer("machine_id").references(
      () => foundationMachinesTable.id,
      { onDelete: "set null" },
    ),
    shiftCode: text("shift_code"),
    goodQty: text("good_qty").notNull(),
    scrapQty: text("scrap_qty").notNull().default("0"),
    reworkQty: text("rework_qty").notNull().default("0"),
    notes: text("notes"),
    recordedBy: integer("recorded_by").notNull().references(() => systemUsersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    batchIdx: index("production_operation_confirmations_batch_idx").on(table.batchId, table.operationNo),
  }),
);

export const productionNcrsTable = pgTable(
  "production_ncrs",
  {
    id: serial("id").primaryKey(),
    ncrNumber: text("ncr_number").notNull().unique(),
    batchId: integer("batch_id").references(() => productionBatchesTable.id),
    workflowOrderId: integer("workflow_order_id").notNull().references(() => productionWorkflowOrdersTable.id),
    defectCode: text("defect_code").notNull(),
    affectedQty: text("affected_qty").notNull(),
    disposition: text("disposition"),
    rootCause: text("root_cause"),
    correctiveAction: text("corrective_action"),
    status: text("status").notNull().default("open"),
    evidence: jsonb("evidence").notNull().default("[]"),
    createdBy: integer("created_by").notNull().references(() => systemUsersTable.id),
    closedBy: integer("closed_by").references(() => systemUsersTable.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    queueIdx: index("production_ncrs_queue_idx").on(table.status, table.createdAt),
    batchIdx: index("production_ncrs_batch_idx").on(table.batchId),
  }),
);

export const productionTraceabilityTable = pgTable(
  "production_traceability",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull().references(() => productionBatchesTable.id),
    workflowOrderId: integer("workflow_order_id").notNull().references(() => productionWorkflowOrdersTable.id),
    traceType: text("trace_type").notNull(), // input_lot | output_lot | shipment
    lotNumber: text("lot_number").notNull(),
    itemCode: text("item_code"),
    quantity: text("quantity"),
    referenceType: text("reference_type"),
    referenceId: integer("reference_id"),
    metadata: jsonb("metadata").notNull().default("{}"),
    recordedBy: integer("recorded_by").notNull().references(() => systemUsersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    lotIdx: index("production_traceability_lot_idx").on(table.lotNumber),
    batchIdx: index("production_traceability_batch_idx").on(table.batchId),
  }),
);

export const createDowntimeSchema = z.object({
  reasonCode: z.string().trim().min(1).max(80),
  minutes: z.number().int().positive(),
  notes: z.string().trim().max(1000).optional().nullable(),
  startedAt: z.string().datetime().optional().nullable(),
  endedAt: z.string().datetime().optional().nullable(),
});

export const createOperationConfirmationSchema = z.object({
  operationNo: z.number().int().positive(),
  machineId: z.number().int().positive().optional().nullable(),
  shiftCode: z.string().trim().max(40).optional().nullable(),
  goodQty: z.string().regex(/^\d+(\.\d{1,3})?$/),
  scrapQty: z.string().regex(/^\d+(\.\d{1,3})?$/).default("0"),
  reworkQty: z.string().regex(/^\d+(\.\d{1,3})?$/).default("0"),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const createNcrSchema = z.object({
  batchId: z.number().int().positive().optional().nullable(),
  workflowOrderId: z.number().int().positive(),
  defectCode: z.string().trim().min(1).max(80),
  affectedQty: z.string().regex(/^\d+(\.\d{1,3})?$/),
  disposition: z.enum(["rework", "scrap", "sort", "use_as_is", "hold"]).optional(),
  evidence: z.array(z.record(z.string(), z.unknown())).default([]),
});

export const createTraceabilitySchema = z.object({
  batchId: z.number().int().positive(),
  workflowOrderId: z.number().int().positive(),
  traceType: z.enum(["input_lot", "output_lot", "shipment"]),
  lotNumber: z.string().trim().min(1).max(100),
  itemCode: z.string().trim().max(100).optional().nullable(),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/).optional().nullable(),
  referenceType: z.string().trim().max(80).optional().nullable(),
  referenceId: z.number().int().positive().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
