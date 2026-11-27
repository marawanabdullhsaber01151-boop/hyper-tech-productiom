/** @format */

import { pgTable, serial, text, numeric, integer, boolean, timestamp, index, unique } from "drizzle-orm/pg-core";
import { inventoryItemsTable } from "./inventory";
import { foundationLocationsTable } from "./foundation";

// المخازن (هجرة 0110): مخزن له نوع من تلاتة (raw خام / wip تحت تشغيل / finished تام)، وفي مخزن افتراضي واحد لكل نوع.
export const warehousesTable = pgTable("warehouses", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  locationId: integer("location_id").references(() => foundationLocationsTable.id, { onDelete: "set null" }),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// رصيد (صنف × مخزن). إجمالي الصنف في inventory_items بيتحسب من مجموع الأرصدة بتريجر في القاعدة.
export const stockBalancesTable = pgTable(
  "stock_balances",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id").notNull().references(() => inventoryItemsTable.id, { onDelete: "cascade" }),
    warehouseId: integer("warehouse_id").notNull().references(() => warehousesTable.id),
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull().default("0"),
    reservedQty: numeric("reserved_qty", { precision: 12, scale: 3 }).notNull().default("0"),
    quarantineQty: numeric("quarantine_qty", { precision: 12, scale: 3 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    itemWh: unique("stock_balances_item_wh_unique").on(t.itemId, t.warehouseId),
    whIdx: index("stock_balances_wh_idx").on(t.warehouseId),
  }),
);

export type Warehouse = typeof warehousesTable.$inferSelect;
export type StockBalance = typeof stockBalancesTable.$inferSelect;
