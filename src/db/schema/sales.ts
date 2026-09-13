/** @format */

import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { contactsTable } from "./contacts";
import { inventoryItemsTable } from "./inventory";

export const salesOrdersTable = pgTable(
  "sales_orders",
  {
    id: serial("id").primaryKey(),
    orderNumber: text("order_number").notNull().unique(),
    contactId: integer("contact_id").references(() => contactsTable.id),
    createdById: integer("created_by_id"),
    channel: text("channel").notNull().default("direct"),
    date: date("date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    revision: integer("revision").notNull().default(1),
    status: text("status").notNull().default("draft"),
    stockSyncStatus: text("stock_sync_status")
      .notNull()
      .default("pending_review"),
    notes: text("notes"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // ✅ indexes للفلترة والبحث الشائع
  (table) => ({
    contactIdx: index("sales_contact_idx").on(table.contactId),
    statusIdx: index("sales_status_idx").on(table.status),
    dateIdx: index("sales_date_idx").on(table.date),
    createdAtIdx: index("sales_created_at_idx").on(table.createdAt),
  }),
);

export const salesOrderItemsTable = pgTable(
  "sales_order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => salesOrdersTable.id, { onDelete: "cascade" }),
    inventoryItemId: integer("inventory_item_id").references(
      () => inventoryItemsTable.id,
    ),
    description: text("description").notNull(),
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
    baseUnit: text("base_unit").notNull().default("unit"),
    packagingQty: numeric("packaging_qty", { precision: 12, scale: 3 })
      .notNull()
      .default("0"),
    packagingUnit: text("packaging_unit").notNull().default("carton"),
    conversionFactor: numeric("conversion_factor", {
      precision: 12,
      scale: 6,
    })
      .notNull()
      .default("1"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  },
  (table) => ({
    orderIdx: index("sales_items_order_idx").on(table.orderId),
  }),
);

export const insertSalesOrderSchema = z.object({
  orderNumber: z.string().min(1, "رقم الأمر مطلوب"),
  contactId: z.number().optional().nullable(),
  createdById: z.number().int().positive().optional().nullable(),
  channel: z.enum(["website", "direct"]).optional(),
  date: z.string().min(1, "التاريخ مطلوب"),
  dueDate: z.string().optional().nullable(),
  status: z
    .enum(["draft", "pending_approval", "confirmed", "shipped", "paid", "cancelled"])
    .default("draft"),
  notes: z.string().optional().nullable(),
  subtotal: z.string().optional().default("0"),
  total: z.string().optional().default("0"),
});

export const insertSalesOrderItemSchema = z.object({
  orderId: z.number(),
  inventoryItemId: z.number().optional().nullable(),
  description: z.string().min(1, "الوصف مطلوب"),
  qty: z
    .string()
    .regex(/^\d+(?:\.\d{1,3})?$/, "الكمية يجب أن تكون رقمًا عشريًا صالحًا")
    .refine((value) => {
      const [whole, fraction = ""] = value.split(".");
      return BigInt(whole) > 0n || /[1-9]/.test(fraction);
    }, {
      message: "الكمية يجب أن تكون أكبر من صفر",
    }),
  baseUnit: z.string().trim().min(1).default("unit"),
  packagingQty: z
    .string()
    .regex(/^\d+(?:\.\d{1,3})?$/, "كمية التعبئة غير صالحة")
    .default("0"),
  packagingUnit: z.string().trim().min(1).default("carton"),
  conversionFactor: z
    .string()
    .regex(/^\d+(?:\.\d{1,6})?$/, "معامل التحويل غير صالح")
    .refine((value) => {
      const [whole, fraction = ""] = value.split(".");
      return BigInt(whole) > 0n || /[1-9]/.test(fraction);
    }, "معامل التحويل يجب أن يكون أكبر من صفر")
    .default("1"),
  unitPrice: z.string(),
  total: z.string(),
});

export type InsertSalesOrder = z.infer<typeof insertSalesOrderSchema>;
export type SalesOrder = typeof salesOrdersTable.$inferSelect;
export type InsertSalesOrderItem = z.infer<typeof insertSalesOrderItemSchema>;
export type SalesOrderItem = typeof salesOrderItemsTable.$inferSelect;
