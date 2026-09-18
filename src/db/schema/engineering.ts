/** @format */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { systemUsersTable } from "./settings";
import {
  foundationItemsTable,
  foundationWorkCentersTable,
  foundationMachinesTable,
} from "./foundation";

export const engineeringProductsTable = pgTable(
  "engineering_products",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    productType: text("product_type").notNull().default("finished"),
    baseUnit: text("base_unit").notNull().default("وحدة"),
    status: text("status").notNull().default("active"),
    description: text("description"),
    // Phase 4 (Governance & Portal project): engineering_products duplicates
    // the Foundation item concept (code/name/base unit/type/status). Nullable
    // link + conservative exact-code backfill, same pattern as
    // inventory_items (0021) and bom_recipes (0057). Legacy unmatched rows
    // stay NULL and keep working on their own fields.
    foundationItemId: integer("foundation_item_id").references(
      () => foundationItemsTable.id,
      { onDelete: "set null" },
    ),
    createdBy: integer("created_by").references(() => systemUsersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeUnique: uniqueIndex("engineering_products_code_unique").on(table.code),
    statusIdx: index("engineering_products_status_idx").on(table.status),
  }),
);

export const engineeringProductVersionsTable = pgTable(
  "engineering_product_versions",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull().references(() => engineeringProductsTable.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    status: text("status").notNull().default("draft"),
    effectiveFrom: date("effective_from", { mode: "string" }),
    effectiveTo: date("effective_to", { mode: "string" }),
    bomSnapshot: jsonb("bom_snapshot").notNull().default("[]"),
    routingSnapshot: jsonb("routing_snapshot").notNull().default("[]"),
    specifications: jsonb("specifications").notNull().default("{}"),
    changeReason: text("change_reason"),
    approvedBy: integer("approved_by").references(() => systemUsersTable.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => systemUsersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    productVersionUnique: uniqueIndex("engineering_product_versions_unique").on(
      table.productId,
      table.version,
    ),
    productStatusIdx: index("engineering_product_versions_status_idx").on(
      table.productId,
      table.status,
    ),
  }),
);

export const engineeringRoutingsTable = pgTable(
  "engineering_routings",
  {
    id: serial("id").primaryKey(),
    productVersionId: integer("product_version_id")
      .notNull()
      .references(() => engineeringProductVersionsTable.id, { onDelete: "cascade" }),
    operationNo: integer("operation_no").notNull(),
    name: text("name").notNull(),
    // Phase 4: these were bare integers with no foreign key — they always
    // meant Foundation records, so nothing stopped them pointing at a
    // deleted or non-existent work center/machine. Now properly linked.
    workCenterId: integer("work_center_id").references(
      () => foundationWorkCentersTable.id,
      { onDelete: "set null" },
    ),
    machineId: integer("machine_id").references(
      () => foundationMachinesTable.id,
      { onDelete: "set null" },
    ),
    setupMinutes: integer("setup_minutes").notNull().default(0),
    runMinutesPerUnit: numeric("run_minutes_per_unit", { precision: 12, scale: 4 }).notNull().default("0"),
    workersRequired: integer("workers_required").notNull().default(1),
    qualityPoint: boolean("quality_point").notNull().default(false),
    safetyInstructions: text("safety_instructions"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionOperationUnique: uniqueIndex("engineering_routings_operation_unique").on(
      table.productVersionId,
      table.operationNo,
    ),
    versionIdx: index("engineering_routings_version_idx").on(table.productVersionId),
  }),
);

export const engineeringChangeRequestsTable = pgTable(
  "engineering_change_requests",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id").notNull().references(() => engineeringProductsTable.id),
    productVersionId: integer("product_version_id").references(() => engineeringProductVersionsTable.id),
    requestNumber: text("request_number").notNull().unique(),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("open"),
    impactSummary: text("impact_summary"),
    requestedBy: integer("requested_by").references(() => systemUsersTable.id),
    decidedBy: integer("decided_by").references(() => systemUsersTable.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    productIdx: index("engineering_change_requests_product_idx").on(table.productId, table.status),
  }),
);

export const createEngineeringProductSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(180),
  productType: z.enum(["raw_material", "semi_finished", "finished"]).default("finished"),
  baseUnit: z.string().trim().min(1).max(30).default("وحدة"),
  description: z.string().trim().max(2000).optional().nullable(),
});

export const createProductVersionSchema = z.object({
  version: z.string().trim().min(1).max(40),
  effectiveFrom: z.string().optional().nullable(),
  effectiveTo: z.string().optional().nullable(),
  bomSnapshot: z.array(z.record(z.string(), z.unknown())).default([]),
  routingSnapshot: z.array(z.record(z.string(), z.unknown())).default([]),
  specifications: z.record(z.string(), z.unknown()).default({}),
  changeReason: z.string().trim().max(2000).optional().nullable(),
});

export const createRoutingSchema = z.object({
  operationNo: z.number().int().positive(),
  name: z.string().trim().min(1).max(180),
  workCenterId: z.number().int().positive().optional().nullable(),
  machineId: z.number().int().positive().optional().nullable(),
  setupMinutes: z.number().int().min(0).default(0),
  runMinutesPerUnit: z.union([z.string(), z.number()]).default("0"),
  workersRequired: z.number().int().positive().default(1),
  qualityPoint: z.boolean().default(false),
  safetyInstructions: z.string().trim().max(2000).optional().nullable(),
});

export const createChangeRequestSchema = z.object({
  productId: z.number().int().positive(),
  productVersionId: z.number().int().positive().optional().nullable(),
  title: z.string().trim().min(1).max(180),
  reason: z.string().trim().min(1).max(2000),
  impactSummary: z.string().trim().max(4000).optional().nullable(),
});
