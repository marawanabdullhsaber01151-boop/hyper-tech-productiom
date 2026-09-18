/** @format */

import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { foundationItemsTable } from "./foundation";

export const inventoryItemsTable = pgTable(
  "inventory_items",
  {
    id: serial("id").primaryKey(),
    code: text("code"),
    name: text("name").notNull(),
    category: text("category").notNull().default("raw_material"),
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull().default("0"),
    reservedQty: numeric("reserved_qty", { precision: 12, scale: 3 })
      .notNull()
      .default("0"),
    quarantineQty: numeric("quarantine_qty", { precision: 12, scale: 3 })
      .notNull()
      .default("0"),
    minQty: numeric("min_qty", { precision: 12, scale: 3 })
      .notNull()
      .default("0"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    unit: text("unit"),
    requiresQualityCheck: boolean("requires_quality_check")
      .notNull()
      .default(false),
    supplierId: integer("supplier_id"),
    // Phase 4 (Governance & Portal project): the FK already existed in the
    // database (migration 0021) but was never declared here, so Drizzle
    // didn't know about the relation. Declared now — no migration needed.
    foundationItemId: integer("foundation_item_id").references(
      () => foundationItemsTable.id,
      { onDelete: "set null" },
    ),
    leadDays: integer("lead_days"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    categoryIdx: index("inventory_category_idx").on(table.category),
    codeIdx: index("inventory_code_idx").on(table.code),
    nameIdx: index("inventory_name_idx").on(table.name),
    supplierIdx: index("inventory_supplier_idx").on(table.supplierId),
    foundationItemIdx: index("inventory_foundation_item_idx").on(table.foundationItemId),
    codeUnique: unique("inventory_code_unique").on(table.code),
  }),
);

export const insertInventoryItemSchema = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1, "الاسم مطلوب"),
  category: z
    .enum(["raw_material", "wip", "finished_good"])
    .default("raw_material"),
  qty: z.string().optional().default("0"),
  reservedQty: z.string().optional().default("0"),
  quarantineQty: z.string().optional().default("0"),
  minQty: z.string().optional().default("0"),
  unitPrice: z.string().optional().default("0"),
  unit: z.string().optional().nullable(),
  requiresQualityCheck: z.boolean().optional().default(false),
  supplierId: z.number().optional().nullable(),
  foundationItemId: z.number().int().positive().optional().nullable(),
  leadDays: z.number().int().optional().nullable(),
});

export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItemsTable.$inferSelect;