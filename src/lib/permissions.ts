/**
 * ✅ مصفوفة الصلاحيات الموحّدة — من هنا بس، مش متكررة في كل ملف route.
 * "chairman" (رئيس مجلس الإدارة) مالك النشاط: صلاحية كتابة كاملة على كل الأقسام التشغيلية.
 *
 * @format
 */

import { eq } from "drizzle-orm";
import {
  OPERATIONS_CONTROL_ACTIONS,
  OPERATIONS_CONTROL_ROLES,
} from "./operations-control-policy";

export const OPERATIONS_MANAGER_PERMISSIONS = {
  caseView: "operations.case.view",
  caseEdit: "operations.case.edit",
} as const;

const PERMISSION_DEFAULT_ROLES: Record<string, readonly string[]> = {
  [OPERATIONS_MANAGER_PERMISSIONS.caseView]: OPERATIONS_CONTROL_ROLES.caseView,
  [OPERATIONS_MANAGER_PERMISSIONS.caseEdit]: OPERATIONS_CONTROL_ROLES.planEdit,
  [OPERATIONS_CONTROL_ACTIONS.analysisRun]: OPERATIONS_CONTROL_ROLES.analysisRun,
  [OPERATIONS_CONTROL_ACTIONS.planCreate]: OPERATIONS_CONTROL_ROLES.planCreate,
  [OPERATIONS_CONTROL_ACTIONS.planEdit]: OPERATIONS_CONTROL_ROLES.planEdit,
  [OPERATIONS_CONTROL_ACTIONS.planSubmit]: OPERATIONS_CONTROL_ROLES.planSubmit,
  [OPERATIONS_CONTROL_ACTIONS.planApprove]: OPERATIONS_CONTROL_ROLES.planApprove,
  [OPERATIONS_CONTROL_ACTIONS.planDispatch]: OPERATIONS_CONTROL_ROLES.planDispatch,
};

export function getDefaultRolesForPermission(
  actionKey: string,
): readonly string[] {
  return PERMISSION_DEFAULT_ROLES[actionKey] ?? [];
}

export const PERMISSIONS = {
  contacts: {
    view: [
      "chairman",
      "executive_manager",
      "sales_manager",
      "online_seller",
      "offline_seller",
      "hr",
      "hr_manager",
    ],
    write: [
      "chairman",
      "sales_manager",
      "online_seller",
      "offline_seller",
      "hr",
      "hr_manager",
    ],
  },
  accounting: {
    view: ["chairman", "hr", "hr_manager"],
    write: ["chairman", "hr", "hr_manager"],
  },
  bom: {
    view: [
      "hr",
      "hr_manager",
      "production_manager",
      "supervisor",
      "production_controller",
      "chairman",
    ],
    write: ["chairman", "hr", "hr_manager"],
  },
  inventory: {
    // ✅ hr و production_manager محتاجين "يشوفوا" المخزون بس عشان ربط مكوّنات الوصفة وتسليم المنتج التام —
    // مش عندهم صفحة المخزون نفسها، لكن محتاجين البيانات في مهامهم هم
    view: [
      "warehouse_manager",
      "storekeeper",
      "chairman",
      "hr",
      "hr_manager",
      "production_manager",
      "production_controller",
      "operations_manager",
      "raw_material_quality_controller",
    ],
    write: ["chairman", "warehouse_manager", "storekeeper"],
  },
  movements: {
    view: ["warehouse_manager", "storekeeper", "chairman"],
    write: ["chairman", "warehouse_manager", "storekeeper"],
  },
  purchases: {
    view: ["purchasing_manager", "buyer", "warehouse_manager", "chairman"],
    write: ["purchasing_manager", "buyer", "chairman"],
  },
  sales: {
    view: [
      "executive_manager",
      "sales_manager",
      "online_seller",
      "offline_seller",
      "hr",
      "hr_manager",
      "chairman",
    ],
    write: [
      "executive_manager",
      "sales_manager",
      "online_seller",
      "offline_seller",
      "hr",
      "hr_manager",
      "chairman",
    ],
  },
  // صلاحيات إدارة حسابات بوابة العملاء منفصلة عن صلاحيات المبيعات العامة.
  // الواجهة الحالية مخصصة لهذه الأدوار الثلاثة فقط.
  portalCustomers: {
    view: ["chairman", "executive_manager", "sales_manager"],
    write: ["chairman", "executive_manager", "sales_manager"],
  },
  hr: {
    view: ["chairman", "hr", "hr_manager"],
    write: ["chairman", "hr", "hr_manager"],
  },
  production: {
    view: [
      "chairman",
      "executive_manager",
      "operations_manager",
      "production_manager",
      "production_controller",
    ],
    write: [
      "chairman",
      "executive_manager",
      "operations_manager",
      "production_manager",
      "production_controller",
    ],
  },
  operationsControl: {
    caseView: [...OPERATIONS_CONTROL_ROLES.caseView],
    analysisRun: [...OPERATIONS_CONTROL_ROLES.analysisRun],
    planCreate: [...OPERATIONS_CONTROL_ROLES.planCreate],
    planEdit: [...OPERATIONS_CONTROL_ROLES.planEdit],
    planSubmit: [...OPERATIONS_CONTROL_ROLES.planSubmit],
    planApprove: [...OPERATIONS_CONTROL_ROLES.planApprove],
    planDispatch: [...OPERATIONS_CONTROL_ROLES.planDispatch],
  },
  reports: {
    view: [
      "chairman",
      "executive_manager",
      "operations_manager",
      "production_manager",
      "production_controller",
    ],
  },
  quality: {
    view: [
      "executive_manager",
      "production_quality_controller",
      "raw_material_quality_controller",
      "quality_engineer",
      "production_manager",
      "operations_manager",
    ],
    write: [
      "chairman",
      "production_quality_controller",
      "raw_material_quality_controller",
      "quality_engineer",
    ],
  },
} as const;

/** Adds an optional ABAC constraint without changing current RBAC behaviour. */
export function applyScopeFilter<
  T extends { where?: (condition: unknown) => T },
>(
  query: T,
  user: { scopeId?: string | null },
  resourceScopeColumn: unknown,
): T {
  if (!user.scopeId || typeof query.where !== "function") return query;
  return query.where(eq(resourceScopeColumn as any, user.scopeId));
}

