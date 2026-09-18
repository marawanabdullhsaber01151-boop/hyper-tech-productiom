/** @format */

import { date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { inventoryItemsTable } from "./inventory";
import { productionWorkflowOrdersTable } from "./production-workflow";
import { systemUsersTable } from "./settings";
import {
  foundationWorkCentersTable,
  foundationMachinesTable,
  foundationShiftsTable,
} from "./foundation";

export const productionPlansTable = pgTable("production_plans", {
  id: serial("id").primaryKey(),
  planNumber: text("plan_number").notNull().unique(),
  status: text("status").notNull().default("draft"),
  demandSource: text("demand_source").notNull().default("manual"),
  dueDate: date("due_date", { mode: "string" }),
  assumptions: jsonb("assumptions").notNull().default("{}"),
  createdBy: integer("created_by").notNull().references(() => systemUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const materialRequirementsTable = pgTable("material_requirements", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id),
  workflowOrderId: integer("workflow_order_id").references(() => productionWorkflowOrdersTable.id),
  grossQty: numeric("gross_qty", { precision: 14, scale: 3 }).notNull(),
  availableQty: numeric("available_qty", { precision: 14, scale: 3 }).notNull(),
  netQty: numeric("net_qty", { precision: 14, scale: 3 }).notNull(),
  requiredBy: date("required_by", { mode: "string" }),
  status: text("status").notNull().default("planned"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  planIdx: index("material_requirements_plan_idx").on(table.planId, table.status),
  itemIdx: index("material_requirements_item_idx").on(table.inventoryItemId),
}));

export const planningPurchaseRequisitionsTable = pgTable("planning_purchase_requisitions", {
  id: serial("id").primaryKey(),
  requisitionNumber: text("requisition_number").notNull().unique(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id),
  materialRequirementId: integer("material_requirement_id").notNull().references(() => materialRequirementsTable.id),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItemsTable.id),
  requestedQty: numeric("requested_qty", { precision: 14, scale: 3 }).notNull(),
  status: text("status").notNull().default("draft"),
  createdBy: integer("created_by").notNull().references(() => systemUsersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const planningRunsTable = pgTable("planning_runs", {
  id: serial("id").primaryKey(),
  runKey: text("run_key").notNull().unique(),
  scenarioCode: text("scenario_code").notNull().default("baseline"),
  status: text("status").notNull().default("draft"),
  horizonStart: date("horizon_start", { mode: "string" }).notNull(),
  horizonEnd: date("horizon_end", { mode: "string" }).notNull(),
  inputHash: text("input_hash").notNull(),
  assumptions: jsonb("assumptions").notNull().default("{}"),
  createdBy: integer("created_by").notNull().references(() => systemUsersTable.id),
  approvedBy: integer("approved_by").references(() => systemUsersTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  releasedBy: integer("released_by").references(() => systemUsersTable.id),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("planning_runs_status_idx").on(table.status, table.createdAt),
  scenarioIdx: index("planning_runs_scenario_idx").on(table.scenarioCode, table.createdAt),
}));

export const planningRunInputsTable = pgTable("planning_run_inputs", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => planningRunsTable.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id"),
  inventoryItemId: integer("inventory_item_id").references(() => inventoryItemsTable.id),
  grossQty: numeric("gross_qty", { precision: 14, scale: 3 }).notNull(),
  requiredBy: date("required_by", { mode: "string" }),
  snapshot: jsonb("snapshot").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  runIdx: index("planning_run_inputs_run_idx").on(table.runId, table.requiredBy),
}));

export const planningCapacityLoadsTable = pgTable("planning_capacity_loads", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => planningRunsTable.id, { onDelete: "cascade" }),
  // Phase 4 (Governance & Portal project): were bare integers with no
  // foreign key — always meant Foundation records, now properly linked so
  // they can't point at a deleted work center / machine / shift.
  workCenterId: integer("work_center_id").references(
    () => foundationWorkCentersTable.id,
    { onDelete: "set null" },
  ),
  machineId: integer("machine_id").references(
    () => foundationMachinesTable.id,
    { onDelete: "set null" },
  ),
  shiftId: integer("shift_id").references(() => foundationShiftsTable.id, {
    onDelete: "set null",
  }),
  loadDate: date("load_date", { mode: "string" }).notNull(),
  requiredMinutes: integer("required_minutes").notNull().default(0),
  availableMinutes: integer("available_minutes").notNull().default(0),
  overloadMinutes: integer("overload_minutes").notNull().default(0),
  status: text("status").notNull().default("within_capacity"),
  explanation: text("explanation").notNull(),
}, (table) => ({
  runDateIdx: index("planning_capacity_loads_run_date_idx").on(table.runId, table.loadDate),
}));

export const planningShortageMessagesTable = pgTable("planning_shortage_messages", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => planningRunsTable.id, { onDelete: "cascade" }),
  materialRequirementId: integer("material_requirement_id").references(() => materialRequirementsTable.id, { onDelete: "cascade" }),
  severity: text("severity").notNull().default("warning"),
  code: text("code").notNull(),
  message: text("message").notNull(),
  explanation: text("explanation").notNull(),
  recommendedAction: text("recommended_action"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  runSeverityIdx: index("planning_shortage_messages_run_idx").on(table.runId, table.severity),
}));

export const planningPeggingLinksTable = pgTable("planning_pegging_links", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => planningRunsTable.id, { onDelete: "cascade" }),
  materialRequirementId: integer("material_requirement_id").notNull().references(() => materialRequirementsTable.id, { onDelete: "cascade" }),
  demandType: text("demand_type").notNull(),
  demandId: text("demand_id"),
  peggedQty: numeric("pegged_qty", { precision: 14, scale: 3 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  runIdx: index("planning_pegging_links_run_idx").on(table.runId, table.materialRequirementId),
}));

export const planningReleaseDecisionsTable = pgTable("planning_release_decisions", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => planningRunsTable.id, { onDelete: "cascade" }),
  decision: text("decision").notNull(),
  decidedBy: integer("decided_by").notNull().references(() => systemUsersTable.id),
  impactSnapshot: jsonb("impact_snapshot").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  runDecisionIdx: uniqueIndex("planning_release_decisions_run_decision_idx").on(table.runId, table.decision),
}));

export const createMrpSchema = z.object({
  dueDate: z.string().optional().nullable(),
  demandSource: z.string().trim().max(80).default("manual"),
  workflowOrderId: z.number().int().positive().optional().nullable(),
  requirements: z.array(z.object({
    inventoryItemId: z.number().int().positive(),
    grossQty: z.string().regex(/^\d+(\.\d{1,3})?$/),
    requiredBy: z.string().optional().nullable(),
  })).min(1),
});

export const createRequisitionSchema = z.object({
  materialRequirementId: z.number().int().positive(),
});

const planningDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ يجب أن يكون بصيغة YYYY-MM-DD");
const planningDemandSchema = z.object({
  sourceType: z.enum(["operations_case", "sales_order", "portal_order", "forecast", "open_production", "manual"]),
  sourceId: z.union([z.string(), z.number()]).optional().nullable(),
  inventoryItemId: z.number().int().positive(),
  grossQty: z.string().regex(/^\d+(\.\d{1,3})?$/),
  requiredBy: planningDate,
  openSupplyQty: z.string().regex(/^\d+(\.\d{1,3})?$/).default("0"),
  leadDays: z.number().int().min(0).default(0),
  snapshot: z.record(z.string(), z.unknown()).default({}),
});

export const createPlanningRunSchema = z.object({
  scenarioCode: z.string().trim().min(1).max(80).default("baseline"),
  horizonStart: planningDate,
  horizonEnd: planningDate,
  assumptions: z.record(z.string(), z.unknown()).default({}),
  demands: z.array(planningDemandSchema).min(1).max(1000),
  capacityLoads: z.array(z.object({
    workCenterId: z.number().int().positive().optional().nullable(),
    machineId: z.number().int().positive().optional().nullable(),
    shiftId: z.number().int().positive().optional().nullable(),
    loadDate: planningDate,
    requiredMinutes: z.number().int().min(0),
    availableMinutes: z.number().int().min(0),
  })).max(2000).default([]),
});

export type CreatePlanningRun = z.infer<typeof createPlanningRunSchema>;
