/** @format */

import { sql } from "drizzle-orm";
import {
  db,
  notificationsTable,
  stockMovementsTable,
  qualityInspectionsTable,
  productionRequestsTable,
  productionWorkflowOrdersTable,
  productionOrdersTable,
  bomRecipeItemsTable,
  bomRecipesTable,
  salesOrderItemsTable,
  salesOrdersTable,
  inventoryItemsTable,
  contactsTable,
  appStateTable,
  systemSettingsTable,
} from "../db";
import { wipeEverythingExcept } from "./wipe";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * ✅ إصلاح جذري: زرار "تصدير نسخة احتياطية كاملة" في الإعدادات كان بيصدّر
 * localStorage بس — والنظام كله بيقرأ وبيكتب من الـ API/قاعدة البيانات
 * مباشرة، مفيش أي بيانات حقيقية بتتخزن في localStorage خالص. يعني كل نسخة
 * احتياطية اتعملت قبل كده كانت شبه فاضية، وأي محاولة استرجاع منها كانت
 * بترجع نجاح وهمي من غير ما ترجّع أي بيانات حقيقية. ده استبدال كامل بنظام
 * حقيقي بيصدّر ويسترجع من قاعدة البيانات فعليًا.
 *
 * الترتيب هنا "الأساسي أولاً" (عكس ترتيب wipe.ts اللي بيمسح الفرعي أولاً) —
 * عشان الاستيراد يقدر يدرج الصفوف الأساسية (contacts, inventory_items...)
 * قبل الصفوف الفرعية اللي بتشير عليها (sales_order_items...).
 */
const BACKUP_TABLES: readonly { name: string; table: any }[] = [
  { name: "contacts", table: contactsTable },
  { name: "inventory_items", table: inventoryItemsTable },
  { name: "sales_orders", table: salesOrdersTable },
  { name: "sales_order_items", table: salesOrderItemsTable },
  { name: "bom_recipes", table: bomRecipesTable },
  { name: "bom_recipe_items", table: bomRecipeItemsTable },
  { name: "production_orders", table: productionOrdersTable },
  { name: "production_workflow_orders", table: productionWorkflowOrdersTable },
  { name: "production_requests", table: productionRequestsTable },
  { name: "quality_inspections", table: qualityInspectionsTable },
  { name: "stock_movements", table: stockMovementsTable },
  { name: "notifications", table: notificationsTable },
  { name: "app_state", table: appStateTable },
  { name: "system_settings", table: systemSettingsTable },
  // ⚠️ ملاحظة مقصودة: system_users و login_sessions مش جوه النسخة
  // الاحتياطية دي عمدًا — استرجاع حسابات وصلاحيات وباسوردات المستخدمين من
  // ملف قديم خطر أمني حقيقي (ممكن يرجّع حساب اتقفل أو صلاحية اتسحبت لسبب).
  // النسخة دي لبيانات الشركة التشغيلية فقط، مش لإدارة الحسابات.
] as const;

export interface BackupFile {
  _version: "1.0.0";
  _exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function exportAllTables(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const { name, table } of BACKUP_TABLES) {
    tables[name] = await db.select().from(table);
  }
  return { _version: "1.0.0", _exportedAt: new Date().toISOString(), tables };
}

function isValidBackupFile(data: unknown): data is BackupFile {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    d._version === "1.0.0" && typeof d.tables === "object" && d.tables !== null
  );
}

/**
 * يستبدل كل البيانات التشغيلية الحالية بالكامل بمحتوى ملف النسخة
 * الاحتياطية. عملية هدّامة تمامًا — بيمر أولاً بنفس آلية "المسح الشامل"
 * الآمنة (كل حاجة بتترحّل للسلة أولاً قبل ما تتمسح)، وبعدين بيدرج بيانات
 * الملف في نفس ترتيب wipe.ts بالظبط بس معكوس (الأساسي قبل الفرعي).
 */
export async function importAllTables(
  data: unknown,
  executingUserId: number,
  executingUserName: string,
  executingSessionId: number,
): Promise<{
  wipeSummary: Record<string, number>;
  importSummary: Record<string, number>;
}> {
  if (!isValidBackupFile(data)) {
    throw Object.assign(new Error("ملف النسخة الاحتياطية غير صالح أو تالف"), {
      status: 400,
    });
  }

  // خطوة 1: تفريغ البيانات الحالية بالكامل (بأمان، عن طريق السلة)
  const wipeSummary = await wipeEverythingExcept(
    executingUserId,
    executingUserName,
    executingSessionId,
  );

  // خطوة 2: إدراج بيانات الملف، بالترتيب الأساسي أولاً
  const importSummary: Record<string, number> = {};
  await db.transaction(async (tx: Tx) => {
    for (const { name, table } of BACKUP_TABLES) {
      const rows = data.tables[name];
      if (!Array.isArray(rows) || rows.length === 0) {
        importSummary[name] = 0;
        continue;
      }
      // ✅ تواريخ الـJSON بترجع كـ نصوص ISO — لازم تتحول لـ Date حقيقية قبل
      // الإدراج، وإلا drizzle هيبعتها كنص خام لعمود timestamp
      const restored = rows.map((row: any) => {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          clean[k] =
            (
              typeof v === "string" &&
              /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)
            ) ?
              new Date(v)
            : v;
        }
        return clean;
      });
      await tx.insert(table).values(restored);
      importSummary[name] = restored.length;

      // ✅ إعادة ضبط الـ sequence بتاع الـ id بعد إدراج قيم صريحة، وإلا أي
      // إدراج جديد بعد الاستيراد هيصطدم بنفس الأرقام القديمة (unique violation)
      await tx.execute(
        sql`SELECT setval(pg_get_serial_sequence(${name}, 'id'), COALESCE((SELECT MAX(id) FROM ${sql.identifier(name)}), 1))`,
      );
    }
  });

  return { wipeSummary, importSummary };
}
