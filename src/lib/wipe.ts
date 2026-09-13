/** @format */

import { eq, ne, and } from "drizzle-orm";
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
  loginSessionsTable,
  appStateTable,
  systemSettingsTable,
  systemUsersTable,
} from "../db";
import { moveToTrash } from "./trash";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * يمسح كل جدول بيانات في النظام (ينقل كل صف للسلة أولاً ثم يحذفه من جدوله)، بترتيب آمن
 * يحترم الروابط بين الجداول (الجداول الفرعية تُمسح قبل الجداول الأساسية اللي بتشير عليها).
 * حساب المدير المنفّذ للعملية هو الوحيد المستثنى من جدول المستخدمين.
 *
 * ✅ إصلاح: لازم نستقبل sessionId بتاع الجلسة الحالية للمدير المنفّذ —
 * عشان نستثنيها من مسح login_sessions ونمنعه يتقطع من النظام فور ما يخلص المسح.
 */
export async function wipeEverythingExcept(
  executingUserId: number,
  executingUserName: string,
  executingSessionId: number,
) {
  const summary: Record<string, number> = {};

  await db.transaction(async (tx: Tx) => {
    const wipe = async (tableName: string, table: any, labelField?: string) => {
      const rows = await tx.select().from(table);
      for (const row of rows) {
        await moveToTrash(
          tx,
          tableName,
          row,
          executingUserId,
          executingUserName,
          labelField ? row[labelField] : null,
        );
      }
      if (rows.length > 0) await tx.delete(table);
      summary[tableName] = rows.length;
    };

    // ✅ الترتيب: الفرعي أولاً ثم الأساسي، عشان ميحصلش تعارض روابط (Foreign Keys)
    await wipe("notifications", notificationsTable);
    await wipe("stock_movements", stockMovementsTable);
    await wipe("quality_inspections", qualityInspectionsTable);
    await wipe("production_requests", productionRequestsTable, "requestNumber");
    await wipe(
      "production_workflow_orders",
      productionWorkflowOrdersTable,
      "orderNumber",
    );
    await wipe("production_orders", productionOrdersTable, "orderNumber");
    await wipe("bom_recipe_items", bomRecipeItemsTable, "materialName");
    await wipe("bom_recipes", bomRecipesTable, "productName");
    await wipe("sales_order_items", salesOrderItemsTable);
    await wipe("sales_orders", salesOrdersTable, "orderNumber");
    await wipe("inventory_items", inventoryItemsTable, "name");
    await wipe("contacts", contactsTable, "name");
    await wipe("app_state", appStateTable);
    await wipe("system_settings", systemSettingsTable, "key");

    // ✅ إصلاح حرج: login_sessions فيها عمود revokedBy بيشير على system_users
    // من غير onDelete cascade/set null — لو فضل أي صف فيها بيشير على مستخدم
    // هيتمسح دلوقتي، عملية حذف المستخدمين تحت هتفشل بالكامل (Foreign Key
    // violation) والمسح كله يقف فجأة. الحل: نمسح login_sessions قبل
    // المستخدمين، ونستثني الجلسة الحالية للمدير المنفّذ نفسه عشان مايتقطعش
    // من النظام فور ما يخلص المسح.
    const sessionRows = await tx
      .select()
      .from(loginSessionsTable)
      .where(ne(loginSessionsTable.id, executingSessionId));
    for (const row of sessionRows) {
      await moveToTrash(
        tx,
        "login_sessions",
        row,
        executingUserId,
        executingUserName,
        null,
      );
    }
    if (sessionRows.length > 0) {
      await tx
        .delete(loginSessionsTable)
        .where(ne(loginSessionsTable.id, executingSessionId));
    }
    summary["login_sessions"] = sessionRows.length;

    // ✅ كل المستخدمين ما عدا حساب المدير المنفّذ نفسه
    const otherUsers = await tx
      .select()
      .from(systemUsersTable)
      .where(ne(systemUsersTable.id, executingUserId));
    for (const u of otherUsers) {
      await moveToTrash(
        tx,
        "system_users",
        u,
        executingUserId,
        executingUserName,
        u.fullName,
      );
    }
    if (otherUsers.length > 0) {
      await tx
        .delete(systemUsersTable)
        .where(ne(systemUsersTable.id, executingUserId));
    }
    summary["system_users"] = otherUsers.length;
  });

  return summary;
}
