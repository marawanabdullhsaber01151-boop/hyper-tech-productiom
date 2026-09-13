/** @format */

import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { systemUsersTable } from "./settings";
import { bomRecipesTable } from "./bom";

// ─── طلبات المواد الخام (من مشرف المصنع) ────────────────────────────────────
export const productionRequestsTable = pgTable(
  "production_requests",
  {
    id: serial("id").primaryKey(),
    requestNumber: text("request_number").notNull().unique(),
    requestedById: integer("requested_by_id")
      .notNull()
      .references(() => systemUsersTable.id),
    requestedByName: text("requested_by_name").notNull(),
    productName: text("product_name").notNull(),
    bomRecipeId: integer("bom_recipe_id").references(() => bomRecipesTable.id),
    workflowOrderId: integer("workflow_order_id"),
    requestedQty: numeric("requested_qty", {
      precision: 12,
      scale: 3,
    }).notNull(),
    unit: text("unit").notNull().default("وحدة"),
    neededBy: date("needed_by", { mode: "string" }),
    reason: text("reason"),
    priority: text("priority").notNull().default("normal"),
    warehouseStatus: text("warehouse_status").notNull().default("pending"),
    approvedQty: numeric("approved_qty", { precision: 12, scale: 3 }),
    warehouseComment: text("warehouse_comment"),
    warehouseActionById: integer("warehouse_action_by_id").references(
      () => systemUsersTable.id,
    ),
    warehouseActionByName: text("warehouse_action_by_name"),
    warehouseActionAt: timestamp("warehouse_action_at", { withTimezone: true }),
    directorStatus: text("director_status").notNull().default("pending"),
    directorComment: text("director_comment"),
    directorActionById: integer("director_action_by_id").references(
      () => systemUsersTable.id,
    ),
    directorActionByName: text("director_action_by_name"),
    directorActionAt: timestamp("director_action_at", { withTimezone: true }),
    directorOverrideQty: numeric("director_override_qty", {
      precision: 12,
      scale: 3,
    }),
    status: text("status").notNull().default("pending_warehouse"),
    finalQty: numeric("final_qty", { precision: 12, scale: 3 }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // ✅ indexes للفلترة بالحالة والمستخدم
  (table) => ({
    statusIdx: index("prod_requests_status_idx").on(table.status),
    requestedByIdx: index("prod_requests_user_idx").on(table.requestedById),
    createdAtIdx: index("prod_requests_created_at_idx").on(table.createdAt),
  }),
);

// ─── الإشعارات ────────────────────────────────────────────────────────────────
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => systemUsersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    referenceType: text("reference_type"),
    referenceId: integer("reference_id"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // ✅ index مركّب — أهم استعلام: إشعارات مستخدم غير مقروءة
  (table) => ({
    userReadIdx: index("notifications_user_read_idx").on(
      table.userId,
      table.isRead,
    ),
    userCreatedIdx: index("notifications_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  }),
);

// ─── Zod Schemas ──────────────────────────────────────────────────────────────
export const createProductionRequestSchema = z.object({
  productName: z.string().min(1, "اسم المنتج مطلوب"),
  bomRecipeId: z.number().int().positive("وصفة التصنيع مطلوبة"),
  requestedQty: z.string().min(1, "الكمية مطلوبة"),
  unit: z.string().default("وحدة"),
  neededBy: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

export const warehouseActionSchema = z.object({
  action: z.enum(["approve", "partial", "reject"]),
  approvedQty: z.string().optional(),
  comment: z.string().optional().nullable(),
});

export const directorActionSchema = z.object({
  action: z.enum(["approve", "override", "reject", "noted"]),
  overrideQty: z.string().optional(),
  comment: z.string().optional().nullable(),
});

export type ProductionRequest = typeof productionRequestsTable.$inferSelect;
export type Notification = typeof notificationsTable.$inferSelect;
