/** @format */

import { Router } from "express";
import { sql, gte } from "drizzle-orm";
import { db } from "../db";
import {
  inventoryItemsTable,
  salesOrdersTable,
  productionWorkflowOrdersTable, // ✅ إصلاح سابق: كان بيقرا من productionOrdersTable (جدول قديم ميت)
  qualityRecordsTable, // ✅ إصلاح سابق: كان بيقرا من qualityInspectionsTable (جدول قديم ميت)
  stockMovementsTable,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

// نقطة أسبوع فات — لحساب مؤشرات الاتجاه (▲▼)
function weekAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}

// ✅ إصلاح باگ حرج: كانت هذه النقطة محمية بـ requireAuth فقط (بدون أي
// requireRole)، أي أن أي مستخدم مسجّل دخول بأي دور (حتى storekeeper أو
// buyer المبتدئين) كان يستطيع رؤية صافي ربح الشركة، الإيرادات،
// المصروفات، وعدد الموظفين. الآن مقيَّدة بالأدوار الشرعية فقط التي
// تستخدمها فعليًا (index.html للإدارة العليا، وproduction.html عبر
// factory-control-tower.js الذي يستخدم فقط أجزاء production/quality/
// inventory منها، لا الجزء المالي أو HR).
router.get("/dashboard", requireAuth, requireRole(
  "chairman",
  "executive_manager",
  "operations_manager",
  "production_manager",
  "production_controller",
), async (_req, res, next) => {
  try {
    const since = weekAgo();

    const [
      inventoryStats,
      salesStats,
      salesLastWeek,
      productionStats,
      productionLastWeek,
      qualityStats,
      qualityLastWeek,
      recentMovements,
      approachingLowStock,
    ] = await Promise.all([
      // Inventory stats
      db
        .select({
          totalItems: sql<number>`count(*)::int`,
          totalValue: sql<number>`coalesce(sum(${inventoryItemsTable.qty}::numeric * ${inventoryItemsTable.unitPrice}::numeric), 0)`,
          lowStockCount: sql<number>`count(*) filter (where ${inventoryItemsTable.qty}::numeric <= ${inventoryItemsTable.minQty}::numeric)::int`,
        })
        .from(inventoryItemsTable),

      // Sales stats
      db
        .select({
          totalOrders: sql<number>`count(*)::int`,
          totalRevenue: sql<number>`coalesce(sum(${salesOrdersTable.total}::numeric), 0)`,
          pendingCount: sql<number>`count(*) filter (where ${salesOrdersTable.status} in ('draft','confirmed'))::int`,
          paidCount: sql<number>`count(*) filter (where ${salesOrdersTable.status} = 'paid')::int`,
        })
        .from(salesOrdersTable),

      // مبيعات آخر 7 أيام — أساس مؤشر الاتجاه
      db
        .select({
          count: sql<number>`count(*)::int`,
          revenue: sql<number>`coalesce(sum(${salesOrdersTable.total}::numeric), 0)`,
        })
        .from(salesOrdersTable)
        .where(gte(salesOrdersTable.createdAt, since)),

      // Production stats — من الجدول الصحيح الشغال فعليًا
      db
        .select({
          totalOrders: sql<number>`count(*)::int`,
          inProgressCount: sql<number>`count(*) filter (where ${productionWorkflowOrdersTable.workflowStatus} not in ('completed','delivered_customer','delivered_warehouse','cancelled'))::int`,
          completedCount: sql<number>`count(*) filter (where ${productionWorkflowOrdersTable.workflowStatus} in ('completed','delivered_customer','delivered_warehouse'))::int`,
        })
        .from(productionWorkflowOrdersTable),

      // أوامر إنتاج آخر 7 أيام
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(productionWorkflowOrdersTable)
        .where(gte(productionWorkflowOrdersTable.createdAt, since)),

      // Quality stats — من الجدول الصحيح الشغال فعليًا
      db
        .select({
          totalInspections: sql<number>`count(*)::int`,
          passCount: sql<number>`count(*) filter (where ${qualityRecordsTable.qualityStatus} = 'passed')::int`,
          failCount: sql<number>`count(*) filter (where ${qualityRecordsTable.qualityStatus} = 'failed')::int`,
        })
        .from(qualityRecordsTable),

      // فحوصات جودة آخر 7 أيام
      db
        .select({
          count: sql<number>`count(*)::int`,
          passCount: sql<number>`count(*) filter (where ${qualityRecordsTable.qualityStatus} = 'passed')::int`,
        })
        .from(qualityRecordsTable)
        .where(gte(qualityRecordsTable.createdAt, since)),

      // Recent stock movements (last 10)
      db
        .select()
        .from(stockMovementsTable)
        .orderBy(sql`${stockMovementsTable.createdAt} desc`)
        .limit(10),

      // أكتر 5 أصناف قربت من النفاذ (مش لسه وصلت للحد، بس قريبة) —
      // بتساعد مدير المخازن/المشتريات ياخد قرار قبل ما تحصل أزمة نقص فعلية.
      // ✨ الآن معروضة فعليًا في الواجهة عبر index.js → renderFinanceQuality()
      db
        .select({
          id: inventoryItemsTable.id,
          name: inventoryItemsTable.name,
          qty: inventoryItemsTable.qty,
          minQty: inventoryItemsTable.minQty,
          // نسبة الاقتراب من حد إعادة الطلب (كل ما رقمها أقل، كل ما هي أقرب للخطر)
          proximityRatio: sql<number>`case when ${inventoryItemsTable.minQty}::numeric > 0
            then round((${inventoryItemsTable.qty}::numeric / ${inventoryItemsTable.minQty}::numeric)::numeric, 2)
            else null end`,
        })
        .from(inventoryItemsTable)
        .where(
          sql`${inventoryItemsTable.minQty}::numeric > 0 and ${inventoryItemsTable.qty}::numeric <= ${inventoryItemsTable.minQty}::numeric * 1.5`,
        )
        .orderBy(
          sql`(${inventoryItemsTable.qty}::numeric / nullif(${inventoryItemsTable.minQty}::numeric, 0)) asc`,
        )
        .limit(5),
    ]);

    const inv = inventoryStats[0];
    const sal = salesStats[0];
    const salWeek = salesLastWeek[0];
    const prod = productionStats[0];
    const prodWeek = productionLastWeek[0];
    const qual = qualityStats[0];
    const qualWeek = qualityLastWeek[0];

    const passRate =
      qual.totalInspections > 0 ?
        Math.round((qual.passCount / qual.totalInspections) * 100)
      : 0;
    const passRateLastWeek =
      qualWeek.count > 0 ?
        Math.round((qualWeek.passCount / qualWeek.count) * 100)
      : null;

    res.json({
      inventory: {
        totalItems: inv.totalItems,
        totalValue: Number(inv.totalValue),
        lowStockCount: inv.lowStockCount,
        // أصناف قربت من حد إعادة الطلب (إنذار مبكر قبل ما توصل صفر)
        approachingLowStock,
      },
      sales: {
        totalOrders: sal.totalOrders,
        totalRevenue: Number(sal.totalRevenue),
        pendingCount: sal.pendingCount,
        paidCount: sal.paidCount,
        // مؤشر اتجاه آخر 7 أيام
        trend: {
          last7DaysOrders: salWeek.count,
          last7DaysRevenue: Number(salWeek.revenue),
        },
      },
      production: {
        totalOrders: prod.totalOrders,
        inProgressCount: prod.inProgressCount,
        completedCount: prod.completedCount,
        // مؤشر اتجاه آخر 7 أيام
        trend: { last7DaysOrders: prodWeek.count },
      },
      quality: {
        totalInspections: qual.totalInspections,
        passCount: qual.passCount,
        failCount: qual.failCount,
        passRate,
        // هل النسبة بتتحسن ولا بتتراجع عن آخر أسبوع؟
        trend: {
          last7DaysInspections: qualWeek.count,
          last7DaysPassRate: passRateLastWeek,
          direction:
            passRateLastWeek === null ? "stable"
            : passRateLastWeek > passRate ? "up"
            : passRateLastWeek < passRate ? "down"
            : "stable",
        },
      },
      recentMovements,
    });
  } catch (err) {
    next(err);
  }
});

// ✅ إصلاح حرج: index.ts بيجمع كل الراوترات بصيغة "export * from './x'"، وهذه
// الصيغة في TypeScript/JavaScript بتتجاهل الـ default export تمامًا (بتمرر
// بس الـ named exports). كان الراوتر هنا معرَّف بـ "export default router"
// فقط، يعني حتى لو اتضاف سطر التصدير في index.ts، الراوتر ما كانش هيوصل
// فعليًا لأي حد بيستورد من index.ts، ونقطة /api/v1/dashboard كانت غالبًا
// مش موصولة بالسيرفر أصلاً. الحل: نضيف named export بجانب الـ default
// (بنفس المرجع، مفيش تكرار منطق) عشان "export * from './dashboard'" يشتغل.
export const dashboardRouter = router;
export default router;
