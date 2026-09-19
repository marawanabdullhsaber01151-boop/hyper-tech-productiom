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
    // Phase 04 (delivery 1): governance additions. status now also accepts
    // "in_review", "released", "superseded", "retired" — see
    // ../domain/engineering-governance.ts for the allowed transitions.
    validationStatus: text("validation_status").notNull().default("not_validated"),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    validationIssues: jsonb("validation_issues"),
    releasedBy: integer("released_by").references(() => systemUsersTable.id),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    supersededByVersionId: integer("superseded_by_version_id"),
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

// Phase 04 (delivery 1): structured, editable BOM components — replaces
// the untyped bom_snapshot jsonb array as the source of truth while a
// version is draft/in_review. bom_snapshot itself becomes a frozen copy of
// these rows, written once at release time (see freezeVersionSnapshot in
// ../lib/engineering-governance.ts), never edited afterward.
export const engineeringBomComponentsTable = pgTable(
  "engineering_bom_components",
  {
    id: serial("id").primaryKey(),
    productVersionId: integer("product_version_id")
      .notNull()
      .references(() => engineeringProductVersionsTable.id, {
        onDelete: "cascade",
      }),
    lineNo: integer("line_no").notNull(),
    componentType: text("component_type").notNull().default("raw_material"),
    foundationItemId: integer("foundation_item_id").references(
      () => foundationItemsTable.id,
    ),
    subAssemblyProductId: integer("sub_assembly_product_id").references(
      () => engineeringProductsTable.id,
    ),
    qty: numeric("qty", { precision: 14, scale: 4 }).notNull(),
    unit: text("unit").notNull(),
    scrapFactorPct: numeric("scrap_factor_pct", { precision: 6, scale: 3 })
      .notNull()
      .default("0"),
    isAlternate: boolean("is_alternate").notNull().default(false),
    alternateGroup: text("alternate_group"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    versionIdx: index("engineering_bom_components_version_idx").on(
      table.productVersionId,
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

export const createBomComponentSchema = z
  .object({
    lineNo: z.number().int().positive(),
    componentType: z
      .enum([
        "raw_material",
        "sub_assembly",
        "substitute",
        "co_product",
        "by_product",
      ])
      .default("raw_material"),
    foundationItemId: z.number().int().positive().optional().nullable(),
    subAssemblyProductId: z.number().int().positive().optional().nullable(),
    qty: z.union([z.string(), z.number()]).refine(
      (v) => Number(v) > 0,
      { message: "الكمية يجب أن تكون أكبر من صفر" },
    ),
    unit: z.string().trim().min(1).max(20),
    scrapFactorPct: z.union([z.string(), z.number()]).default(0),
    isAlternate: z.boolean().default(false),
    alternateGroup: z.string().trim().max(80).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .refine(
    (v) => Boolean(v.foundationItemId) !== Boolean(v.subAssemblyProductId),
    {
      message: "حدد صنفًا أساسيًا أو منتجًا فرعيًا واحدًا فقط، وليس الاثنين معًا أو لا شيء",
    },
  );

export const decideEngineeringVersionSchema = z.object({
  reason: z.string().trim().min(3, "سبب القرار مطلوب").optional(),
});

export const supersedeEngineeringVersionSchema = z.object({
  supersededByVersionId: z.number().int().positive(),
  reason: z.string().trim().min(3, "سبب الاستبدال مطلوب"),
});

export const createChangeRequestSchema = z.object({
  productId: z.number().int().positive(),
  productVersionId: z.number().int().positive().optional().nullable(),
  title: z.string().trim().min(1).max(180),
  reason: z.string().trim().min(1).max(2000),
  impactSummary: z.string().trim().max(4000).optional().nullable(),
});
