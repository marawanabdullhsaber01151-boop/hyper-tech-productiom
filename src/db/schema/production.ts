/** @format */

import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  timestamp,
  date,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { bomRecipesTable } from "./bom";

export const productionOrdersTable = pgTable(
  "production_orders",
  {
    id: serial("id").primaryKey(),
    orderNumber: text("order_number").notNull().unique(),
    bomRecipeId: integer("bom_recipe_id").references(() => bomRecipesTable.id),
    productName: text("product_name").notNull(),
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
    status: text("status").notNull().default("planned"),
    stages: jsonb("stages").default("[]"),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // ✅ indexes — كانت ناقصة رغم إن الجدول بيتفلتر بالحالة كتير
  (table) => ({
    statusIdx: index("production_status_idx").on(table.status),
    bomRecipeIdx: index("production_bom_recipe_idx").on(table.bomRecipeId),
  }),
);

export const insertProductionOrderSchema = z.object({
  orderNumber: z.string().min(1, "رقم أمر الإنتاج مطلوب"),
  bomRecipeId: z.number().optional().nullable(),
  productName: z.string().min(1, "اسم المنتج مطلوب"),
  qty: z.string(),
  status: z
    .enum(["planned", "in_progress", "completed", "cancelled"])
    .default("planned"),
  stages: z.unknown().optional(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type InsertProductionOrder = z.infer<typeof insertProductionOrderSchema>;
export type ProductionOrder = typeof productionOrdersTable.$inferSelect;
