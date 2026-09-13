/** @format */
/**
 * Portal Order Reviews — مراجعة طلبات بوابة العملاء
 *
 * كل طلب من البوابة بيوصل كمجموعة أوامر إنتاج (production_workflow_orders)
 * بيشاركوا نفس batchRef. قبل ما الطلب يتحرك، لازم موظف (hr/sales/admin)
 * يراجعه، يحدد سعر كل صنف، ويرد على العميل. المراجعة دي بتتسجل هنا —
 * صف واحد لكل batchRef.
 */
import { pgTable, serial, text, integer, timestamp, date } from "drizzle-orm/pg-core";
import { z } from "zod";

export const portalOrderReviewsTable = pgTable("portal_order_reviews", {
  id: serial("id").primaryKey(),
  batchRef: text("batch_ref").notNull().unique(),
  status: text("status").notNull().default("confirmed"), // confirmed / rejected
  replyMessage: text("reply_message"),
  expectedDelivery: date("expected_delivery", { mode: "string" }),
  rejectReason: text("reject_reason"),
  salesOrderId: integer("sales_order_id"), // الفاتورة (أمر البيع) اللي اتولّدت تلقائيًا عند التأكيد
  reviewedById: integer("reviewed_by_id").notNull(),
  reviewedByName: text("reviewed_by_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const confirmPortalBatchSchema = z.object({
  items: z
    .array(
      z.object({
        workflowOrderId: z.number(),
        unitPrice: z.string().min(1, "السعر مطلوب لكل صنف"),
      }),
    )
    .min(1),
  replyMessage: z.string().optional().nullable(),
  expectedDelivery: z.string().optional().nullable(),
});

export const rejectPortalBatchSchema = z.object({
  reason: z.string().min(1, "سبب الرفض مطلوب"),
  replyMessage: z.string().optional().nullable(),
  expectedDelivery: z.string().optional().nullable(),
});

export type PortalOrderReview = typeof portalOrderReviewsTable.$inferSelect;
