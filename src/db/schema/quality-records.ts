/** @format */

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { productionWorkflowOrdersTable } from "./production-workflow";

/**
 * ✅ سجل تقييم مراقب الجودة — لكل أمر إنتاج بعد انتهاء فحص الجودة:
 * نتيجة الفحص + تقييم رقمي اختياري للمشرف/الفريق المسؤول عن الأمر.
 * تتجمع هذه السجلات مع الوقت في تقرير أداء لكل مشرف/خط إنتاج (صفحة التقارير).
 *
 * ✅ منقولة من صفحة "مراقبة الجودة" القديمة (قبل حذفها): الفحص بالعينة،
 * العيوب كتاجات منفصلة، وقائمة الفحص التفصيلية.
 */
export const qualityRecordsTable = pgTable("quality_records", {
  id: serial("id").primaryKey(),
  workflowOrderId: integer("workflow_order_id")
    .notNull()
    .references(() => productionWorkflowOrdersTable.id, {
      onDelete: "cascade",
    }),
  orderNumber: text("order_number").notNull(),
  productionLine: text("production_line"),
  supervisorId: integer("supervisor_id"),
  supervisorName: text("supervisor_name"),
  qualityStatus: text("quality_status").notNull(), // passed / failed
  qualityNotes: text("quality_notes"),
  performanceRating: integer("performance_rating"), // 1-5 اختياري — تقييم المشرف/الفريق لهذا الأمر
  // ─── الفحص بالعينة ────────────────────────────────────────────────────────
  sampleSize: integer("sample_size"),
  samplePassedCount: integer("sample_passed_count"),
  sampleFailedCount: integer("sample_failed_count"),
  // ─── العيوب المكتشفة (كل عيب سطر منفصل) ────────────────────────────────────
  defectTags: jsonb("defect_tags").notNull().default([]),
  // ─── قائمة الفحص التفصيلية [{label, ok}] ───────────────────────────────────
  checklist: jsonb("checklist").notNull().default([]),
  recordedById: integer("recorded_by_id").notNull(),
  recordedByName: text("recorded_by_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertQualityRecordSchema = z.object({
  workflowOrderId: z.number(),
  orderNumber: z.string(),
  productionLine: z.string().optional().nullable(),
  supervisorId: z.number().optional().nullable(),
  supervisorName: z.string().optional().nullable(),
  qualityStatus: z.enum(["passed", "failed"]),
  qualityNotes: z.string().optional().nullable(),
  performanceRating: z.number().min(1).max(5).optional().nullable(),
  sampleSize: z.number().int().min(0).optional().nullable(),
  samplePassedCount: z.number().int().min(0).optional().nullable(),
  sampleFailedCount: z.number().int().min(0).optional().nullable(),
  defectTags: z.array(z.string()).optional().default([]),
  checklist: z
    .array(z.object({ label: z.string(), ok: z.boolean() }))
    .optional()
    .default([]),
});

export type QualityRecord = typeof qualityRecordsTable.$inferSelect;
