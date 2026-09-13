/** @format */

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getNavForRole } from "../lib/departments";
import { db, operationsCasesTable } from "../db";
import { count, eq } from "drizzle-orm";
import type { UserRole } from "../lib/roles";

const router = Router();
const PENDING_CASES_CACHE_MS = 15_000;
let pendingCasesCache: { value: number; expiresAt: number } | null = null;

async function getPendingOperationsCasesCount() {
  const now = Date.now();
  if (pendingCasesCache && pendingCasesCache.expiresAt > now) {
    return pendingCasesCache.value;
  }

  const [result] = await db
    .select({ count: count(operationsCasesTable.id) })
    .from(operationsCasesTable)
    .where(eq(operationsCasesTable.status, "received"));
  const value = Number(result?.count ?? 0);
  pendingCasesCache = { value, expiresAt: now + PENDING_CASES_CACHE_MS };
  return value;
}

/**
 * GET /api/v1/nav
 * ✅ يرجّع شجرة التنقل (قسم → محور → صفحة) مفلترة حسب دور المستخدم
 * الحالي فقط — هذا هو المصدر الوحيد اللي الفرونت إند لازم يبني بيه
 * الـ sidebar وصفحة اختيار الأقسام (index.html)، بدل القائمة الثابتة
 * القديمة اللي كانت بتعرض كل الصفحات لكل الناس بغض النظر عن الدور.
 *
 * كمان بيرجّع:
 *  - singleDepartment: true لو المستخدم عنده قسم واحد بس → الفرونت إند
 *    لازم يوجهه مباشرة للوحة القسم ده، مش لصفحة اختيار الأقسام.
 *  - homeHref: أول صفحة في أول محور في القسم الوحيد بتاعه (لو عنده قسم واحد).
 *
 * ⚠️ هذا الـ endpoint للعرض/التنقل بس. الحماية الحقيقية لكل صفحة تبقى
 * دايمًا مسؤولية data-allowed-roles + page-guard.js في الفرونت إند،
 * وPERMISSIONS + requireRole/requirePermission في كل route بالباك إند.
 */
router.get("/nav", requireAuth, async (req, res, next) => {
  try {
    const role = req.user!.role as UserRole;
    let departments = getNavForRole(role);
    const canViewOperationsInbox = departments.some((department) =>
      department.subFunctions.some((subFunction) =>
        subFunction.pages.some(
          (page) => page.id === "operations-manager-inbox",
        ),
      ),
    );
    if (canViewOperationsInbox) {
      const pendingOperationsCases = await getPendingOperationsCasesCount();
      departments = departments.map((department) => ({
        ...department,
        subFunctions: department.subFunctions.map((subFunction) => ({
          ...subFunction,
          pages: subFunction.pages.map((page) =>
            page.id === "operations-manager-inbox"
              ? { ...page, badgeCount: pendingOperationsCases }
              : page,
          ),
        })),
      }));
    }

    const singleDepartment = departments.length === 1;
    let homeHref: string | null = null;
    if (singleDepartment) {
      const dept = departments[0];
      const firstSub = dept.subFunctions[0];
      homeHref = firstSub?.pages[0]?.href ?? null;
    }

    res.json({
      role,
      departments,
      singleDepartment,
      homeHref,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
