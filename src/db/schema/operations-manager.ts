import {
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { contactsTable } from "./contacts";
import { inventoryItemsTable } from "./inventory";
import { salesOrderItemsTable, salesOrdersTable } from "./sales";
import { systemUsersTable } from "./settings";

export type OperationsSourceSnapshot = {
  capturedAt: string;
  salesOrderRevision: number;
  salesOrder: {
    id: number;
    orderNumber: string;
    status: string;
    date: string;
    dueDate: string | null;
    channel: string;
    notes: string | null;
    subtotal: string;
    total: string;
  };
  customer: {
    id: number | null;
    displayName: string | null;
  };
  lines: Array<{
    salesOrderItemId: number;
    inventoryItemId: number | null;
    productName: string;
    orderedQty: string;
    unitPrice: string;
    total: string;
    baseUnit: string;
    packagingQty: string;
    packagingUnit: string;
    conversionFactor: string;
    dueDate: string | null;
  }>;
};

export const operationsCasesTable = pgTable(
  "operations_cases",
  {
    id: serial("id").primaryKey(),
    caseNumber: text("case_number").notNull().unique(),
    salesOrderId: integer("sales_order_id")
      .notNull()
      .references(() => salesOrdersTable.id),
    salesOrderRevision: integer("sales_order_revision").notNull(),
    workflowOrderId: integer("workflow_order_id"),
    status: text("status").notNull().default("received"),
    priority: text("priority").notNull().default("normal"),
    dueDate: date("due_date", { mode: "string" }),
    assignedTo: integer("assigned_to").references(() => systemUsersTable.id),
    customerId: integer("customer_id").references(() => contactsTable.id),
    customerDisplayName: text("customer_display_name"),
    sourceSnapshot: jsonb("source_snapshot")
      .$type<OperationsSourceSnapshot>()
      .notNull(),
    currentRevision: integer("current_revision").notNull().default(1),
    version: integer("version").notNull().default(1),
    createdBy: integer("created_by")
      .notNull()
      .references(() => systemUsersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sourceUnique: uniqueIndex("operations_cases_sales_revision_unique").on(
      table.salesOrderId,
      table.salesOrderRevision,
    ),
    statusIdx: index("operations_cases_status_idx").on(table.status),
    assignedIdx: index("operations_cases_assigned_idx").on(table.assignedTo),
  }),
);

export const operationsCaseLinesTable = pgTable(
  "operations_case_lines",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id")
      .notNull()
      .references(() => operationsCasesTable.id, { onDelete: "cascade" }),
    salesOrderItemId: integer("sales_order_item_id").references(
      () => salesOrderItemsTable.id,
      { onDelete: "set null" },
    ),
    inventoryItemId: integer("inventory_item_id").references(
      () => inventoryItemsTable.id,
      { onDelete: "set null" },
    ),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    orderedQty: numeric("ordered_qty", { precision: 18, scale: 6 }).notNull(),
    baseUnit: text("base_unit").notNull().default("unit"),
    packagingQty: numeric("packaging_qty", { precision: 18, scale: 6 })
      .notNull()
      .default("0"),
    packagingUnit: text("packaging_unit").notNull().default("carton"),
    conversionFactor: numeric("conversion_factor", {
      precision: 18,
      scale: 6,
    })
      .notNull()
      .default("1"),
    dueDate: date("due_date", { mode: "string" }),
    lineStatus: text("line_status").notNull().default("received"),
  },
  (table) => ({
    caseLineUnique: uniqueIndex("operations_case_lines_case_item_unique").on(
      table.caseId,
      table.salesOrderItemId,
    ),
    caseIdx: index("operations_case_lines_case_idx").on(table.caseId),
  }),
);

export const operationsCaseRevisionsTable = pgTable(
  "operations_case_revisions",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id")
      .notNull()
      .references(() => operationsCasesTable.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    snapshot: jsonb("snapshot")
      .$type<OperationsSourceSnapshot>()
      .notNull(),
    changeReason: text("change_reason"),
    changedBy: integer("changed_by")
      .notNull()
      .references(() => systemUsersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    caseRevisionUnique: uniqueIndex(
      "operations_case_revisions_case_revision_unique",
    ).on(table.caseId, table.revision),
    caseRevisionIdx: index("operations_case_revisions_case_idx").on(
      table.caseId,
      table.revision,
    ),
  }),
);

export type OperationsCase = typeof operationsCasesTable.$inferSelect;
export type OperationsCaseLine = typeof operationsCaseLinesTable.$inferSelect;
export type OperationsCaseRevision =
  typeof operationsCaseRevisionsTable.$inferSelect;