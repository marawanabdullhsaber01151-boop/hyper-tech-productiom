/** @format */
/**
 * Delivery Method Rules — قاعدة تحديد طريقة التسليم (Phase 3)
 *
 * جدول عتبات بسيط قابل للتعديل من الإعدادات بدون أي نشر كود جديد. كل صف
 * "شرط → نتيجة": لو حجم/قيمة السطر وقعوا في المدى المحدد، والتوقيت (قبل/بعد
 * الميعاد) طابق الشرط، تتطبّق طريقة التسليم دي. يُقيَّم الترتيب حسب
 * "priority" (الأصغر أولًا)، وأول قاعدة نشطة تتطابق هي اللي تكسب — راجع
 * src/lib/deliveryMethod.ts للمنطق الفعلي ولقاعدة fallback الافتراضية.
 */
import {
  pgTable,
  serial,
  integer,
  numeric,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod";

export const deliveryMethodRulesTable = pgTable("delivery_method_rules", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(), // اسم وصفي للقاعدة يشوفه الأدمن بس، مش العميل
  // null = بدون حد أدنى/أقصى في هذا البُعد
  minQty: numeric("min_qty", { precision: 12, scale: 3 }),
  maxQty: numeric("max_qty", { precision: 12, scale: 3 }),
  minValue: numeric("min_value", { precision: 12, scale: 2 }),
  maxValue: numeric("max_value", { precision: 12, scale: 2 }),
  // "any" (لسه معروفش)، "on_time"، "late" — يتحدد بمقارنة تاريخ الاكتمال
  // الفعلي بـ neededBy وقت التقييم؛ لسه مفيهوش تاريخ اكتمال = "any" دايمًا
  timing: text("timing").notNull().default("any"),
  deliveryMethod: text("delivery_method").notNull(), // customer / warehouse
  priority: integer("priority").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertDeliveryMethodRuleSchema = z.object({
  label: z.string().min(1, "اسم القاعدة مطلوب"),
  minQty: z.string().optional().nullable(),
  maxQty: z.string().optional().nullable(),
  minValue: z.string().optional().nullable(),
  maxValue: z.string().optional().nullable(),
  timing: z.enum(["any", "on_time", "late"]).default("any"),
  deliveryMethod: z.enum(["customer", "warehouse"]),
  priority: z.number().int().optional().default(100),
  isActive: z.boolean().optional().default(true),
});

export type DeliveryMethodRule = typeof deliveryMethodRulesTable.$inferSelect;
export type InsertDeliveryMethodRule = z.infer<
  typeof insertDeliveryMethodRuleSchema
>;
