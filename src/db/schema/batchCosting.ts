/** @format */
// التكلفة المعيارية وكشوف تكلفة الدفعات (54، هجرة 0108).
import { integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { bomRecipesTable } from "./bom";
import { productionBatchesTable } from "./operations";
import { productionWorkflowOrdersTable } from "./production-workflow";

export const recipeStandardCostsTable = pgTable("recipe_standard_costs", {
  recipeId: integer("recipe_id").primaryKey().references(() => bomRecipesTable.id, { onDelete: "cascade" }),
  labor: numeric("labor", { precision: 14, scale: 2 }).notNull().default("0"),
  machine: numeric("machine", { precision: 14, scale: 2 }).notNull().default("0"),
  energy: numeric("energy", { precision: 14, scale: 2 }).notNull().default("0"),
  overhead: numeric("overhead", { precision: 14, scale: 2 }).notNull().default("0"),
  yieldPercent: numeric("yield_percent", { precision: 5, scale: 2 }).notNull().default("100"),
  version: integer("version").notNull().default(1),
  updatedBy: integer("updated_by"),
  updatedByName: text("updated_by_name").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recipeStandardHistoryTable = pgTable("recipe_standard_history", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => bomRecipesTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  labor: numeric("labor", { precision: 14, scale: 2 }).notNull(),
  machine: numeric("machine", { precision: 14, scale: 2 }).notNull(),
  energy: numeric("energy", { precision: 14, scale: 2 }).notNull(),
  overhead: numeric("overhead", { precision: 14, scale: 2 }).notNull(),
  yieldPercent: numeric("yield_percent", { precision: 5, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  changedBy: integer("changed_by"),
  changedByName: text("changed_by_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const batchCostSheetsTable = pgTable("batch_cost_sheets", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().unique().references(() => productionBatchesTable.id),
  orderId: integer("order_id").notNull().references(() => productionWorkflowOrdersTable.id),
  recipeId: integer("recipe_id").references(() => bomRecipesTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"),
  standardVersion: integer("standard_version"),
  producedQty: numeric("produced_qty", { precision: 14, scale: 3 }).notNull(),
  acceptedQty: numeric("accepted_qty", { precision: 14, scale: 3 }).notNull(),
  scrapQty: numeric("scrap_qty", { precision: 14, scale: 3 }).notNull(),
  reworkQty: numeric("rework_qty", { precision: 14, scale: 3 }).notNull(),
  stdMaterial: numeric("std_material", { precision: 14, scale: 2 }).notNull(),
  stdLabor: numeric("std_labor", { precision: 14, scale: 2 }).notNull(),
  stdMachine: numeric("std_machine", { precision: 14, scale: 2 }).notNull(),
  stdEnergy: numeric("std_energy", { precision: 14, scale: 2 }).notNull(),
  stdOverhead: numeric("std_overhead", { precision: 14, scale: 2 }).notNull(),
  actMaterial: numeric("act_material", { precision: 14, scale: 2 }).notNull(),
  actLabor: numeric("act_labor", { precision: 14, scale: 2 }).notNull(),
  actMachine: numeric("act_machine", { precision: 14, scale: 2 }).notNull(),
  actEnergy: numeric("act_energy", { precision: 14, scale: 2 }).notNull(),
  actOverhead: numeric("act_overhead", { precision: 14, scale: 2 }).notNull(),
  actWaste: numeric("act_waste", { precision: 14, scale: 2 }).notNull(),
  stdTotal: numeric("std_total", { precision: 14, scale: 2 }).notNull(),
  actTotal: numeric("act_total", { precision: 14, scale: 2 }).notNull(),
  varianceTotal: numeric("variance_total", { precision: 14, scale: 2 }).notNull(),
  efficiencyLoss: numeric("efficiency_loss", { precision: 14, scale: 2 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
  priceSource: text("price_source"),
  revenue: numeric("revenue", { precision: 14, scale: 2 }),
  profit: numeric("profit", { precision: 14, scale: 2 }),
  computedBy: integer("computed_by"),
  computedByName: text("computed_by_name").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  finalizedByName: text("finalized_by_name"),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
});
