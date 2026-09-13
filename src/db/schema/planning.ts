/** @format */

import { date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod";
import { inventoryItemsTable } from "./inventory";
import { productionWorkflowOrdersTable } from "./production-workflow";
import { systemUsersTable } from "./settings";

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
