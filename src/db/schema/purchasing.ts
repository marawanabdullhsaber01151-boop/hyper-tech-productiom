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

export const purchaseReceiptsTable = pgTable(
  "purchase_receipts",
  {
    id: serial("id").primaryKey(),
    receiptNumber: text("receipt_number").notNull().unique(),
    poId: integer("po_id")
      .notNull()
      .references(() => purchaseOrdersTable.id),
    status: text("status").notNull().default("pending_inspection"),
    notes: text("notes"),
    receivedBy: integer("received_by").notNull(),
    receivedByName: text("received_by_name"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    inspectedBy: integer("inspected_by"),
    inspectedByName: text("inspected_by_name"),
    inspectedAt: timestamp("inspected_at", { withTimezone: true }),
    inspectionNotes: text("inspection_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("purchase_receipts_status_idx").on(t.status, t.createdAt),
    poIdx: index("purchase_receipts_po_idx").on(t.poId),
  }),
);

export const purchaseReceiptLinesTable = pgTable(
  "purchase_receipt_lines",
  {
    id: serial("id").primaryKey(),
    receiptId: integer("receipt_id")
      .notNull()
      .references(() => purchaseReceiptsTable.id, { onDelete: "cascade" }),
    poItemId: integer("po_item_id")
      .notNull()
      .references(() => purchaseOrderItemsTable.id),
    inventoryItemId: integer("inventory_item_id").notNull(),
    description: text("description").notNull(),
    unit: text("unit"),
    qtyReceived: numeric("qty_received", { precision: 14, scale: 3 }).notNull(),
    qtyAccepted: numeric("qty_accepted", { precision: 14, scale: 3 }),
    qtyRejected: numeric("qty_rejected", { precision: 14, scale: 3 }),
    rejectReason: text("reject_reason"),
  },
  (t) => ({
    receiptIdx: index("purchase_receipt_lines_receipt_idx").on(t.receiptId),
    poItemIdx: index("purchase_receipt_lines_po_item_idx").on(t.poItemId),
  }),
);

export type PurchaseReceipt = typeof purchaseReceiptsTable.$inferSelect;
export type PurchaseReceiptLine = typeof purchaseReceiptLinesTable.$inferSelect;
export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;
export type PurchaseOrderItem = typeof purchaseOrderItemsTable.$inferSelect;
