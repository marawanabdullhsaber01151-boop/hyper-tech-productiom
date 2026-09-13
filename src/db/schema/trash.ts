/** @format */

import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod";

// ✅ سلة المهملات الشاملة — أي حذف في أي جدول بالنظام يمر من هنا أولاً
// لا يوجد حذف نهائي فوري في النظام: كل سجل يُنقل هنا قبل حذفه من جدوله الأصلي.
export const trashTable = pgTable(
  "trash",
  {
    id: serial("id").primaryKey(),
    tableName: text("table_name").notNull(), // اسم الجدول الأصلي (مثال: "contacts")
    recordId: integer("record_id").notNull(), // الـ id الأصلي للسجل داخل جدوله
    label: text("label"), // وصف مختصر يسهل عرضه في واجهة السلة (مثال: اسم العميل أو رقم الفاتورة)
    recordData: jsonb("record_data").notNull(), // نسخة كاملة من السجل كما كان قبل الحذف
    deletedByUserId: integer("deleted_by_user_id"), // من قام بالحذف
    deletedByName: text("deleted_by_name"), // اسم من قام بالحذف (منسوخ وقت الحذف لسهولة العرض)
    deletedAt: timestamp("deleted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    restoredAt: timestamp("restored_at", { withTimezone: true }), // فارغة = لسه في السلة، ممتلئة = تم الاسترجاع
  },
  (table) => ({
    tableNameIdx: index("trash_table_name_idx").on(table.tableName),
    deletedAtIdx: index("trash_deleted_at_idx").on(table.deletedAt),
    restoredAtIdx: index("trash_restored_at_idx").on(table.restoredAt),
  }),
);

export const restoreTrashItemSchema = z.object({
  id: z.number(),
});

export type TrashItem = typeof trashTable.$inferSelect;
