/** @format */

import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { inventoryItemsTable } from "./inventory";

export const stockMovementsTable = pgTable(
  "stock_movements",
  {
    id: serial("id").primaryKey(),
    inventoryItemId: integer("inventory_item_id")
      .notNull()
      .references(() => inventoryItemsTable.id),
    movementType: text("movement_type").notNull(),
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
    referenceType: text("reference_type"),
    referenceId: integer("reference_id"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // ✅ indexes — هذا الجدول يُستعلم عنه كثيراً بالصنف ونوع الحركة
  (table) => ({
    itemIdx: index("movements_item_idx").on(table.inventoryItemId),
    typeIdx: index("movements_type_idx").on(table.movementType),
    refIdx: index("movements_ref_idx").on(
      table.referenceType,
      table.referenceId,
    ),
    createdAtIdx: index("movements_created_at_idx").on(table.createdAt),
  }),
);

export const insertStockMovementSchema = z.object({
  inventoryItemId: z.number(),
  movementType: z.enum(["in", "out"]),
  qty: z.string(),
  referenceType: z
    .enum(["purchase", "sale", "production", "adjustment"])
    .optional()
    .nullable(),
  referenceId: z.number().optional().nullable(),
  unitPrice: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type InsertStockMovement = z.infer<typeof insertStockMovementSchema>;
export type StockMovement = typeof stockMovementsTable.$inferSelect;
