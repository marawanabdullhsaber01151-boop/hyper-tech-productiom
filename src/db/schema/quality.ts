/** @format */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod";

export const qualityInspectionsTable = pgTable(
  "quality_inspections",
  {
    id: serial("id").primaryKey(),
    referenceType: text("reference_type"),
    referenceId: integer("reference_id"),
    referenceName: text("reference_name"),
    inspectionDate: date("inspection_date", { mode: "string" }).notNull(),
    inspector: text("inspector").notNull(),
    result: text("result").notNull().default("pass"),
    defectCount: integer("defect_count").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // ✅ index مركّب — الاستعلام الشائع هو فحوصات مرجع معين (أمر إنتاج/شراء)
  (table) => ({
    refIdx: index("quality_ref_idx").on(table.referenceType, table.referenceId),
    resultIdx: index("quality_result_idx").on(table.result),
  }),
);

export const insertQualityInspectionSchema = z.object({
  referenceType: z.enum(["production", "purchase"]).optional().nullable(),
  referenceId: z.number().optional().nullable(),
  referenceName: z.string().optional().nullable(),
  inspectionDate: z.string().min(1, "تاريخ الفحص مطلوب"),
  inspector: z.string().min(1, "اسم المفتش مطلوب"),
  result: z.enum(["pass", "fail"]).default("pass"),
  defectCount: z.number().int().default(0),
  notes: z.string().optional().nullable(),
});

export type InsertQualityInspection = z.infer<
  typeof insertQualityInspectionSchema
>;
export type QualityInspection = typeof qualityInspectionsTable.$inferSelect;
