/** @format */

import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { inventoryItemsTable } from "./inventory";

export const bomRecipesTable = pgTable("bom_recipes", {
  id: serial("id").primaryKey(),
  productCode: text("product_code"),
  productName: text("product_name").notNull(),
  description: text("description"),
  outputQty: numeric("output_qty", { precision: 12, scale: 3 })
    .notNull()
    .default("1"),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  // Phase 3: reference-only price shown to the customer on the portal at
  // order time (an estimate — real pricing is still confirmed by portal
  // sales when the batch is reviewed, unchanged from before). Never wired
  // to any payment/invoice/balance logic.
  referencePrice: numeric("reference_price", { precision: 12, scale: 2 }),
  // Phase 3: whole days of expected production time for one full batch of
  // outputQty, used by the due-date suggestion formula in
  // src/lib/dueDateSuggestion.ts. Nullable — recipes created before this
  // phase (or never given an estimate) simply fall back to a system
  // default in that formula rather than failing.
  expectedProductionDays: integer("expected_production_days"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const bomRecipeItemsTable = pgTable("bom_recipe_items", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id")
    .notNull()
    .references(() => bomRecipesTable.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id").references(
    () => inventoryItemsTable.id,
  ),
  materialName: text("material_name").notNull(),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  unit: text("unit").notNull().default("pcs"),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
});

export const insertBomRecipeSchema = z.object({
  productCode: z.string().optional().nullable(),
  productName: z.string().min(1, "اسم المنتج مطلوب"),
  description: z.string().optional().nullable(),
  outputQty: z.string().optional().default("1"),
  unitCost: z.string().optional().default("0"),
  referencePrice: z.string().optional().nullable(),
  expectedProductionDays: z.number().int().positive().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

export const insertBomRecipeItemSchema = z.object({
  recipeId: z.number(),
  inventoryItemId: z.number().optional().nullable(),
  materialName: z.string().min(1, "اسم المادة مطلوب"),
  qty: z.string(),
  unit: z.string().default("pcs"),
  unitCost: z.string().optional().default("0"),
});

export type InsertBomRecipe = z.infer<typeof insertBomRecipeSchema>;
export type BomRecipe = typeof bomRecipesTable.$inferSelect;
export type InsertBomRecipeItem = z.infer<typeof insertBomRecipeItemSchema>;
export type BomRecipeItem = typeof bomRecipeItemsTable.$inferSelect;
