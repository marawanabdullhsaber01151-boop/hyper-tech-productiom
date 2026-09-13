/** @format */

import { sql } from "drizzle-orm";
import { db, trashTable } from "../db";

// ✅ يقبل db العادي أو tx (transaction) — مشتقة من نوع الـ callback بتاع db.transaction نفسه
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AnyDb = typeof db | Tx;

/**
 * ينقل سجل لسلة المهملات قبل حذفه من جدوله الأصلي.
 * لازم يتنفذ هو والحذف الفعلي جوه نفس الـ transaction (لو الـ route بيستخدم transaction أصلاً).
 *
 * @param dbOrTx  db العادي أو tx (transaction) لو العملية جوه transaction
 * @param tableName  اسم الجدول الحقيقي في postgres (زي "contacts", "inventory_items"...)
 * @param record  السجل الكامل كما كان قبل الحذف (نتيجة select) — أي شكل/أعمدة
 * @param userId  آي دي المستخدم اللي بينفذ الحذف (أو null لو النظام هو اللي حذف)
 * @param userName  اسم المستخدم (لعرضه في السلة من غير الحاجة لـ join لاحقًا)
 * @param label  وصف مختصر يسهل التعرف على السجل في واجهة السلة (اسم/رقم فاتورة...)
 */
export async function moveToTrash(
  dbOrTx: AnyDb,
  tableName: string,
  record: Record<string, unknown>,
  userId: number | null,
  userName: string | null,
  label?: string | null,
): Promise<void> {
  if (!record || typeof (record as { id?: unknown }).id !== "number") {
    throw new Error(
      `moveToTrash: السجل المطلوب نقله للسلة لازم يحتوي على id رقمي (الجدول: ${tableName})`,
    );
  }
  await dbOrTx.insert(trashTable).values({
    tableName,
    recordId: (record as { id: number }).id,
    label: label ?? null,
    recordData: record,
    deletedByUserId: userId,
    deletedByName: userName,
  });
}

/**
 * يسترجع سجل من السلة إلى جدوله الأصلي كما كان بالظبط، باستخدام jsonb_populate_record
 * (حيلة postgres بتعيد بناء صف كامل لأي جدول من بيانات JSON مطابقة لأسماء أعمدته).
 * يعمل مع أي جدول بأي شكل من غير ما نكتب منطق خاص لكل جدول.
 */
export async function restoreFromTrash(trashId: number, dbOrTx: AnyDb = db) {
  const [item] = await dbOrTx
    .select()
    .from(trashTable)
    .where(sql`${trashTable.id} = ${trashId}`)
    .limit(1);

  if (!item) {
    throw Object.assign(new Error("العنصر غير موجود في السلة"), {
      status: 404,
    });
  }
  if (item.restoredAt) {
    throw Object.assign(new Error("العنصر تم استرجاعه بالفعل من قبل"), {
      status: 400,
    });
  }

  // ✅ بناء صف كامل للجدول الأصلي من بيانات JSON المحفوظة، وإدراجه فيه من جديد
  await dbOrTx.execute(sql`
    INSERT INTO ${sql.identifier(item.tableName)}
    SELECT * FROM jsonb_populate_record(NULL::${sql.identifier(item.tableName)}, ${JSON.stringify(item.recordData)}::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);

  await dbOrTx
    .update(trashTable)
    .set({ restoredAt: new Date() })
    .where(sql`${trashTable.id} = ${trashId}`);

  return item;
}
