import { pgTable, serial, integer, text, numeric, timestamp, date, index } from "drizzle-orm/pg-core";

export const purchaseOrdersTable = pgTable(
  "purchase_orders",
  {
    id: serial("id").primaryKey(),
    poNumber: text("po_number").notNull().unique(),
    supplierId: integer("supplier_id").notNull(),
    status: text("status").notNull().default("draft"),
    expectedDate: date("expected_date", { mode: "string" }),
    notes: text("notes"),
    total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
    createdBy: integer("created_by").notNull(),
    createdByName: text("created_by_name"),
    approvedBy: integer("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("purchase_orders_status_idx").on(t.status, t.createdAt),
    supplierIdx: index("purchase_orders_supplier_idx").on(t.supplierId),
  }),
);

export const purchaseOrderItemsTable = pgTable(
  "purchase_order_items",
  {
    id: serial("id").primaryKey(),
    poId: integer("po_id")
      .notNull()
      .references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
    inventoryItemId: integer("inventory_item_id").notNull(),
    description: text("description").notNull(),
    unit: text("unit"),
    qty: numeric("qty", { precision: 14, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
    receivedQty: numeric("received_qty", { precision: 14, scale: 3 }).notNull().default("0"),
    requisitionSource: text("requisition_source"),
    requisitionId: integer("requisition_id"),
  },
  (t) => ({
    poIdx: index("purchase_order_items_po_idx").on(t.poId),
    itemIdx: index("purchase_order_items_item_idx").on(t.inventoryItemId),
  }),
);

export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;
export type PurchaseOrderItem = typeof purchaseOrderItemsTable.$inferSelect;
