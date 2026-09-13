/** @format */
/**
 * Production Workflow — نظام دورة الإنتاج المتكاملة
 *
 * مراحل الدورة:
 *  1. new              — تم إنشاء أمر الإنتاج (محاسب / مدير)
 *  2. pending_supervisor — في انتظار قبول مشرف الإنتاج
 *  3. materials_requested — المشرف طلب المواد الخام من مدير المخازن
 *  4. materials_approved  — مدير المخازن وافق (كامل) → تم الخصم من المخزون
 *  5. materials_partial   — مدير المخازن وافق جزئياً
 *  6. materials_rejected  — مدير المخازن رفض
 *  7. in_production       — المشرف بدأ الإنتاج (بعد تعيين المهندس ومراقب الجودة)
 *  8. quality_check       — مراقب الجودة يفحص الإنتاج
 *  9. completed           — مراقب الجودة أبلغ باكتمال الإنتاج
 * 10. delivered_customer  — مدير الإنتاج سلّم للعميل
 * 11. delivered_warehouse — مدير الإنتاج سلّم للمخزن
 * 12. cancelled           — ملغي
 */

import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  timestamp,
  date,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";

import { z } from "zod";
import { bomRecipesTable } from "./bom";
import { salesOrdersTable } from "./sales";
import { portalCustomersTable } from "./portal-customers";

// ─── جدول أوامر الإنتاج الموسّع بدورة الإنتاج ───────────────────────────────
export const productionWorkflowOrdersTable = pgTable(
  "production_workflow_orders",
  {
    id: serial("id").primaryKey(),

    // ─── معلومات أمر الإنتاج الأساسية ───────────────────────────────────────
    orderNumber: text("order_number").notNull().unique(),
    workflowStatus: text("workflow_status").notNull().default("new"),

    // ─── مصدر الطلب (طلب العميل) ─────────────────────────────────────────────
    salesOrderId: integer("sales_order_id").references(
      () => salesOrdersTable.id,
    ),
    parentWorkflowOrderId: integer("parent_workflow_order_id"),
    rootSalesOrderId: integer("root_sales_order_id").references(() => salesOrdersTable.id),
    sourceType: text("source_type"),
    salesOrderRef: text("sales_order_ref"), // رقم أمر البيع
    customerName: text("customer_name"), // اسم العميل (للمشرف فقط — بدون تفاصيل مالية)
    customerPhone: text("customer_phone"),
    customerEmail: text("customer_email"),
    orderSource: text("order_source"), // "website" أو "direct" — مرجعي بس، لا صفحة ولا صلاحيات لمسؤول الموقع
    orderDetails: text("order_details"), // تفاصيل الطلب المرسلة للمشرف
    // namespace مستقل لملكية أوامر بوابة العملاء؛ createdById يظل للتوافق القديم
    portalCustomerId: integer("portal_customer_id").references(
      () => portalCustomersTable.id,
    ),

    // ─── منشئ الطلب (محاسب / مدير) ──────────────────────────────────────────
    createdById: integer("created_by_id").notNull(),
    createdByName: text("created_by_name").notNull(),

    // ─── المنتج وكمية الإنتاج ─────────────────────────────────────────────────
    bomRecipeId: integer("bom_recipe_id").references(() => bomRecipesTable.id),
    productName: text("product_name").notNull(),
    qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
    unit: text("unit").notNull().default("وحدة"),
    priority: text("priority").notNull().default("normal"),
    neededBy: date("needed_by", { mode: "string" }),
    notes: text("notes"),

    // ─── مشرف الإنتاج ────────────────────────────────────────────────────────
    supervisorId: integer("supervisor_id"),
    supervisorName: text("supervisor_name"),
    supervisorAcceptedAt: timestamp("supervisor_accepted_at", {
      withTimezone: true,
    }),
    supervisorNotes: text("supervisor_notes"),

    // ─── طلب المواد الخام ────────────────────────────────────────────────────
    // requestedMaterials: مصفوفة JSON: [{inventoryItemId, materialName, requestedQty, unit}]
    requestedMaterials: jsonb("requested_materials").default("[]"),
    materialRequestId: integer("material_request_id"), // رابط لجدول production_requests
    materialsRequestedAt: timestamp("materials_requested_at", {
      withTimezone: true,
    }),

    // ─── قرار مدير المخازن ───────────────────────────────────────────────────
    warehouseManagerId: integer("warehouse_manager_id"),
    warehouseManagerName: text("warehouse_manager_name"),
    warehouseDecision: text("warehouse_decision"), // approve / partial / reject
    warehouseApprovedQty: numeric("warehouse_approved_qty", {
      precision: 12,
      scale: 3,
    }),
    warehouseComment: text("warehouse_comment"),
    warehouseDecidedAt: timestamp("warehouse_decided_at", {
      withTimezone: true,
    }),

    // ─── تعيين الفريق (بعد موافقة المخازن) ──────────────────────────────────
    assignedEngineerId: integer("assigned_engineer_id"),
    assignedEngineerName: text("assigned_engineer_name"),
    qualityControllerUserId: integer("quality_controller_user_id"),
    qualityControllerName: text("quality_controller_name"),
    teamAssignedAt: timestamp("team_assigned_at", { withTimezone: true }),
    productionLine: text("production_line"), // خط الإنتاج — يحدده مدير الإنتاج عند الاستلام
    operationalStatus: text("operational_status"), // "running" أو "pending"
    pendingReason: text("pending_reason"), // سبب التعليق (إجباري لو operationalStatus = pending)
    receivedByUserId: integer("received_by_user_id"), // مدير الإنتاج اللي استلم الطلب
    receivedByName: text("received_by_name"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    currentStage: text("current_stage"), // line_setup / manufacturing / assembly_packing / ready_for_quality

    // ─── مرحلة الجودة ────────────────────────────────────────────────────────
    qualityStatus: text("quality_status").default("pending"), // pending / in_progress / passed / failed
    qualityNotes: text("quality_notes"),
    qualityDoneAt: timestamp("quality_done_at", { withTimezone: true }),
    qualityReportedById: integer("quality_reported_by_id"),
    qualityReportedByName: text("quality_reported_by_name"),

    // ─── التسليم النهائي (مدير الإنتاج) ─────────────────────────────────────
    deliveryType: text("delivery_type"), // customer / warehouse
    deliveryNotes: text("delivery_notes"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveredById: integer("delivered_by_id"),
    deliveredByName: text("delivered_by_name"),
    deliveryInitiatedById: integer("delivery_initiated_by_id"),
    deliveryInitiatedByName: text("delivery_initiated_by_name"),
    deliveryInitiatedAt: timestamp("delivery_initiated_at", {
      withTimezone: true,
    }),
    pendingDeliveryInventoryItemId: integer(
      "pending_delivery_inventory_item_id",
    ),
    pendingDeliveryAddToInventory: boolean(
      "pending_delivery_add_to_inventory",
    ).default(false),

    // ─── تواريخ عامة ─────────────────────────────────────────────────────────
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

export const createWorkflowOrderSchema = z.object({
  productName: z.string().optional(), // ✅ يُتجاهل — الاسم دايمًا مُشتق من الوصفة نفسها
  qty: z.string().min(1, "الكمية مطلوبة"),
  unit: z.string().default("وحدة"),
  bomRecipeId: z.number({ required_error: "لازم تختار منتج له وصفة تصنيع" }),
  salesOrderId: z.number().optional().nullable(),
  salesOrderRef: z.string().optional().nullable(),
  customerName: z.string().min(1, "اسم العميل مطلوب"),
  customerPhone: z.string().optional().nullable(),
  customerEmail: z.string().email().optional().nullable().or(z.literal("")),
  orderSource: z.enum(["website", "direct"]).default("direct"),
  orderDetails: z.string().optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  neededBy: z.string().min(1, "تاريخ التسليم مطلوب"),
  notes: z.string().optional().nullable(),
});

export const supervisorAcceptSchema = z.object({
  notes: z.string().optional().nullable(),
});

// ✅ استلام مدير الإنتاج للطلب: يعيّن المشرف ومراقب الجودة (من حسابات حقيقية بالـ id، مش نص حر) وخط الإنتاج وتاريخ البداية
export const receiveOrderSchema = z
  .object({
    supervisorId: z.number({ required_error: "لازم تختار المشرف من القائمة" }),
    qualityControllerUserId: z.number({
      required_error: "لازم تختار مراقب الجودة من القائمة",
    }),
    productionLine: z.string().min(1, "خط الإنتاج مطلوب"),
    startDate: z.string().min(1, "تاريخ بداية الإنتاج مطلوب"),
    operationalStatus: z.enum(["running", "pending"]),
    pendingReason: z.string().optional().nullable(),
  })
  .refine(
    (d) => d.operationalStatus !== "pending" || !!d.pendingReason?.trim(),
    {
      message: "سبب التعليق مطلوب عند اختيار حالة معلّق",
      path: ["pendingReason"],
    },
  );

export const changeNeededBySchema = z.object({
  neededBy: z.string().min(1, "تاريخ التسليم مطلوب"),
  reason: z.string().optional().nullable(),
});

export const requestMaterialsSchema = z.object({
  materials: z
    .array(
      z.object({
        inventoryItemId: z.number().optional().nullable(),
        materialName: z.string().min(1),
        requestedQty: z.string(),
        unit: z.string().default("وحدة"),
      }),
    )
    .min(1, "يجب تحديد مادة واحدة على الأقل"),
  notes: z.string().optional().nullable(),
});

export const warehouseWorkflowActionSchema = z.object({
  action: z.enum(["approve", "partial", "reject"]),
  approvedQty: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
  // تفاصيل الموافقة على كل مادة (في حالة partial)
  materialDecisions: z
    .array(
      z.object({
        materialName: z.string(),
        inventoryItemId: z.number().optional().nullable(),
        approvedQty: z.string(),
        unit: z.string().default("وحدة"),
      }),
    )
    .optional(),
});

export const assignTeamSchema = z.object({
  assignedEngineerId: z.number().optional().nullable(),
  assignedEngineerName: z.string().min(1, "اسم المهندس مطلوب"),
  qualityControllerUserId: z.number().optional().nullable(),
  qualityControllerName: z.string().min(1, "اسم مراقب الجودة مطلوب"),
  startDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const qualityDoneSchema = z.object({
  qualityStatus: z.enum(["passed", "failed"]),
  qualityNotes: z.string().optional().nullable(),
  performanceRating: z.number().min(1).max(5).optional().nullable(), // تقييم اختياري للمشرف/الفريق
  // ✅ منقولة من صفحة مراقبة الجودة القديمة
  sampleSize: z.number().int().min(0).optional().nullable(),
  samplePassedCount: z.number().int().min(0).optional().nullable(),
  sampleFailedCount: z.number().int().min(0).optional().nullable(),
  defectTags: z.array(z.string()).optional().default([]),
  checklist: z
    .array(z.object({ label: z.string(), ok: z.boolean() }))
    .optional()
    .default([]),
});

export const deliverProductSchema = z.object({
  deliveryType: z.enum(["customer", "warehouse"]),
  deliveryNotes: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  // لو تسليم للمخزن: إضافة المنتج النهائي
  inventoryItemId: z.number().optional().nullable(),
  addToInventory: z.boolean().optional().default(false),
});

export type ProductionWorkflowOrder =
  typeof productionWorkflowOrdersTable.$inferSelect;
export type CreateWorkflowOrder = z.infer<typeof createWorkflowOrderSchema>;
