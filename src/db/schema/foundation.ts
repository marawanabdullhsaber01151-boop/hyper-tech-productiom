/** @format */
/**
 * Phase 0 — Foundation master data.
 * This module is additive: it does not replace inventory, production, or workflow tables.
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod";

const code = z.string().trim().min(1).max(80);
const name = z.string().trim().min(1).max(160);

export const FOUNDATION_ITEM_STATUSES = [
  "draft",
  "pending_approval",
  "active",
  "superseded",
  "retired",
] as const;
export type FoundationItemStatus = (typeof FOUNDATION_ITEM_STATUSES)[number];

export const foundationItemsTable = pgTable(
  "foundation_items",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    itemType: text("item_type").notNull().default("raw_material"),
    baseUnit: text("base_unit").notNull(),
    active: boolean("active").notNull().default(true),
    lotTracked: boolean("lot_tracked").notNull().default(true),
    serialTracked: boolean("serial_tracked").notNull().default(false),
    shelfLifeDays: integer("shelf_life_days"),
    minStock: text("min_stock").notNull().default("0"),
    notes: text("notes"),
    // Phase 03 (delivery 3): governance fields. `active` above is kept as
    // the compatibility boolean every other module already reads; routes
    // keep it in sync with `status` rather than removing it.
    status: text("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    ownerId: text("owner_id"),
    ownerName: text("owner_name"),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    supersededByItemId: integer("superseded_by_item_id"),
    pendingChangePayload: jsonb("pending_change_payload"),
    pendingChangeReason: text("pending_change_reason"),
    pendingChangeRequestedById: text("pending_change_requested_by_id"),
    pendingChangeRequestedByName: text("pending_change_requested_by_name"),
    pendingChangeRequestedAt: timestamp("pending_change_requested_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    codeUnique: uniqueIndex("foundation_items_code_unique").on(table.code),
    typeIndex: index("foundation_items_type_idx").on(table.itemType),
    activeIndex: index("foundation_items_active_idx").on(table.active),
    statusIndex: index("foundation_items_status_idx").on(table.status),
  }),
);

// Phase 03 (delivery 3): one row per change to a foundation item, holding
// the snapshot from *before* the change (same convention as
// foundation_audit.before_data) so "what did version N look like" is a
// direct lookup and the live row is always the current version.
export const foundationItemVersionsTable = pgTable(
  "foundation_item_versions",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => foundationItemsTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    changedById: text("changed_by_id"),
    changedByName: text("changed_by_name"),
    changeReason: text("change_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    itemVersionUnique: uniqueIndex(
      "foundation_item_versions_item_version_unique",
    ).on(table.itemId, table.version),
    itemIndex: index("foundation_item_versions_item_idx").on(
      table.itemId,
      table.createdAt,
    ),
  }),
);

// Phase 03 (delivery 3): alternate names/codes an item is also known by —
// legacy codes, customer-facing names, supplier part numbers. Used for
// search and duplicate-record detection.
export const foundationItemAliasesTable = pgTable(
  "foundation_item_aliases",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => foundationItemsTable.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    createdById: text("created_by_id"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    itemAliasUnique: uniqueIndex(
      "foundation_item_aliases_item_alias_unique",
    ).on(table.itemId, table.alias),
  }),
);

export const foundationItemDuplicateCodeReviewTable = pgTable(
  "foundation_items_duplicate_code_review",
  {
    id: serial("id").primaryKey(),
    normalizedCode: text("normalized_code").notNull(),
    itemIds: integer("item_ids").array().notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolved: boolean("resolved").notNull().default(false),
  },
);

export const createFoundationItemAliasSchema = z.object({
  alias: z.string().trim().min(1).max(160),
});

// Fields a change to any of which requires the approval workflow rather
// than a direct write. Kept in one place so the route and any future
// import/export path stay consistent about what "critical" means.
export const CRITICAL_FOUNDATION_ITEM_FIELDS = [
  "baseUnit",
  "itemType",
  "minStock",
] as const;

export const requestFoundationItemChangeSchema = z.object({
  changes: z
    .object({
      code: code.optional(),
      name: name.optional(),
      itemType: z.string().trim().min(1).max(40).optional(),
      baseUnit: z.string().trim().min(1).max(20).optional(),
      lotTracked: z.boolean().optional(),
      serialTracked: z.boolean().optional(),
      shelfLifeDays: z.number().int().positive().nullable().optional(),
      minStock: z.string().trim().optional(),
      notes: z.string().trim().max(2000).nullable().optional(),
      effectiveFrom: z.string().trim().nullable().optional(),
      effectiveTo: z.string().trim().nullable().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: "لا يوجد تغيير مقترح",
    }),
  reason: z.string().trim().min(3, "سبب طلب التغيير مطلوب"),
});

export const decideFoundationItemChangeSchema = z.object({
  reason: z.string().trim().min(3, "سبب القرار مطلوب").optional(),
});

export const foundationUnitConversionsTable = pgTable(
  "foundation_unit_conversions",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => foundationItemsTable.id, { onDelete: "cascade" }),
    fromUnit: text("from_unit").notNull(),
    toUnit: text("to_unit").notNull(),
    factor: text("factor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    itemIndex: index("foundation_unit_conversions_item_idx").on(table.itemId),
    pairUnique: uniqueIndex("foundation_unit_conversions_pair_unique").on(
      table.itemId,
      table.fromUnit,
      table.toUnit,
    ),
  }),
);

export const foundationLocationsTable = pgTable(
  "foundation_locations",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    locationType: text("location_type").notNull().default("warehouse"),
    parentId: integer("parent_id"),
    active: boolean("active").notNull().default(true),
    allowsInventory: boolean("allows_inventory").notNull().default(true),
    allowsProduction: boolean("allows_production").notNull().default(false),
    requiresQuarantine: boolean("requires_quarantine").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    codeUnique: uniqueIndex("foundation_locations_code_unique").on(table.code),
    parentIndex: index("foundation_locations_parent_idx").on(table.parentId),
    typeIndex: index("foundation_locations_type_idx").on(table.locationType),
  }),
);

export const foundationWorkCentersTable = pgTable(
  "foundation_work_centers",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    centerType: text("center_type").notNull().default("production_line"),
    locationId: integer("location_id").references(
      () => foundationLocationsTable.id,
    ),
    capacityMinutesPerShift: integer("capacity_minutes_per_shift")
      .notNull()
      .default(480),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    codeUnique: uniqueIndex("foundation_work_centers_code_unique").on(
      table.code,
    ),
    locationIndex: index("foundation_work_centers_location_idx").on(
      table.locationId,
    ),
  }),
);

export const foundationMachinesTable = pgTable(
  "foundation_machines",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    workCenterId: integer("work_center_id")
      .notNull()
      .references(() => foundationWorkCentersTable.id),
    status: text("status").notNull().default("available"),
    serialNumber: text("serial_number"),
    calibrationDueDate: date("calibration_due_date", { mode: "string" }),
    maintenanceDueDate: date("maintenance_due_date", { mode: "string" }),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    codeUnique: uniqueIndex("foundation_machines_code_unique").on(table.code),
    centerIndex: index("foundation_machines_center_idx").on(table.workCenterId),
    statusIndex: index("foundation_machines_status_idx").on(table.status),
  }),
);

export const foundationShiftsTable = pgTable(
  "foundation_shifts",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    breakMinutes: integer("break_minutes").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    codeUnique: uniqueIndex("foundation_shifts_code_unique").on(table.code),
  }),
);

export const foundationTransitionsTable = pgTable(
  "foundation_state_transitions",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    requiredRole: text("required_role").notNull(),
    requiresReason: boolean("requires_reason").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueTransition: uniqueIndex("foundation_state_transitions_unique").on(
      table.entityType,
      table.fromState,
      table.toState,
      table.requiredRole,
    ),
    entityIndex: index("foundation_state_transitions_entity_idx").on(
      table.entityType,
    ),
  }),
);

export const foundationAuditTable = pgTable(
  "foundation_audit",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    action: text("action").notNull(),
    actorId: text("actor_id"),
    actorRole: text("actor_role"),
    reason: text("reason"),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    entityIndex: index("foundation_audit_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
    createdIndex: index("foundation_audit_created_idx").on(table.createdAt),
  }),
);

export const foundationItemSchema = z.object({
  code,
  name,
  itemType: z
    .enum(["raw_material", "wip", "finished_good", "packaging", "consumable"])
    .default("raw_material"),
  baseUnit: code,
  lotTracked: z.boolean().default(true),
  serialTracked: z.boolean().default(false),
  shelfLifeDays: z.number().int().positive().optional().nullable(),
  minStock: z
    .string()
    .regex(/^\d+(\.\d{1,3})?$/)
    .default("0"),
  notes: z.string().max(1000).optional().nullable(),
  // Phase 03 (delivery 2/3): PATCH-only field. Without this, `.partial()`
  // silently drops `active` from the request body (zod strips unknown
  // keys), so the inactivation guard added in delivery 2 could never
  // actually fire — this was caught and fixed while extending the same
  // route in delivery 3, not left in place.
  active: z.boolean().optional(),
});

export const foundationConversionSchema = z.object({
  itemId: z.number().int().positive(),
  fromUnit: code,
  toUnit: code,
  factor: z.string().regex(/^\d+(\.\d{1,8})?$/).refine(
    (value) => Number(value) > 0,
    "معامل التحويل يجب أن يكون أكبر من صفر",
  ),
}).superRefine((value, ctx) => {
  if (value.fromUnit === value.toUnit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toUnit"],
      message: "وحدتا القياس يجب أن تكونا مختلفتين",
    });
  }
});

export const foundationLocationSchema = z.object({
  code,
  name,
  locationType: z
    .enum([
      "warehouse",
      "quarantine",
      "wip",
      "production",
      "finished_goods",
      "scrap",
    ])
    .default("warehouse"),
  parentId: z.number().int().positive().optional().nullable(),
  allowsInventory: z.boolean().default(true),
  allowsProduction: z.boolean().default(false),
  requiresQuarantine: z.boolean().default(false),
  notes: z.string().max(1000).optional().nullable(),
  active: z.boolean().optional(),
});

export const foundationWorkCenterSchema = z.object({
  code,
  name,
  centerType: z.string().trim().min(1).max(80).default("production_line"),
  locationId: z.number().int().positive().optional().nullable(),
  capacityMinutesPerShift: z.number().int().positive().default(480),
  notes: z.string().max(1000).optional().nullable(),
  active: z.boolean().optional(),
});

export const foundationMachineSchema = z.object({
  code,
  name,
  workCenterId: z.number().int().positive(),
  status: z
    .enum([
      "available",
      "running",
      "down",
      "maintenance",
      "calibration",
      "retired",
    ])
    .default("available"),
  serialNumber: z.string().trim().max(120).optional().nullable(),
  calibrationDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  maintenanceDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const foundationShiftSchema = z.object({
  code,
  name,
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "وقت غير صحيح"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "وقت غير صحيح"),
  breakMinutes: z.number().int().min(0).max(720).default(0),
});

export const foundationTransitionSchema = z.object({
  entityType: z.enum([
    "production_order",
    "production_operation",
    "batch",
    "quality_lot",
  ]),
  fromState: code,
  toState: code,
  requiredRole: code,
  requiresReason: z.boolean().default(false),
});
