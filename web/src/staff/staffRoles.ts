/** أدوار صفحات الموظفين في ملف صغير، عشان الراوتر يفحص الصلاحية من غير ما يحمّل الصفحة نفسها. */
import { SALES_ROLES } from "../admin/session";

/** نفس أدوار قايمة /nav للمشتريات + رئيس المجلس. */
export const STOCK_ROLES = ["chairman", "purchasing_manager", "buyer", "warehouse_manager", "storekeeper"] as const;

/** لازم تتطابق مع ACCESS.systemHealthRead في السيرفر. */
export const HEALTH_ROLES = ["chairman", "executive_manager"] as const;

export const SALES_PAGE_ROLES = SALES_ROLES;

/** نفس PERMISSIONS.contacts.view / write في السيرفر. */
export const CONTACT_ROLES = ["chairman", "executive_manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"] as const;
export const CONTACT_WRITE_ROLES = ["chairman", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"] as const;

/** نفس OPERATIONS_CONTROL_ROLES.caseView / planEdit في السيرفر (مركز قيادة التشغيل). */
/** الإنتاج: اتحاد أدوار طلبات الإنتاج والجودة (التفاصيل في productionRules). */
export { PRODUCTION_PAGE_ROLES } from "./productionRules";

/** الهندسة: نفس engineeringRoles في السيرفر. */
import { ENGINEERING_ROLES } from "./engineeringCore";
import { RECIPE_VIEW_ROLES } from "./recipesCore";
/** البيانات الأساسية: نفس FOUNDATION_ROLES في السيرفر. */
import { FOUNDATION_ROLES } from "./foundationCore";
export const FOUNDATION_PAGE_ROLES: readonly string[] = FOUNDATION_ROLES;

/** التخطيط: نفس planningRoles في السيرفر. */
import { PLANNING_ROLES } from "./planningCore";
export const PLANNING_PAGE_ROLES: readonly string[] = PLANNING_ROLES;

export const ENGINEERING_PAGE_ROLES = [...new Set([...ENGINEERING_ROLES, ...RECIPE_VIEW_ROLES])] as readonly string[];

export const OPERATIONS_ROLES = ["chairman", "executive_manager", "operations_manager"] as const;

/** فحص استلام الخامات: نفس RECEIPT_READ_ROLES في السيرفر (src/lib/receiving.ts). */
export const RECEIVING_PAGE_ROLES = ["chairman", "executive_manager", "purchasing_manager", "buyer", "warehouse_manager", "storekeeper", "raw_material_quality_controller"] as const;

/** سجل النشاط: نفس ACTIVITY_ROLES في السيرفر (src/routes/activity.ts). */
export { ACTIVITY_ROLES as ACTIVITY_PAGE_ROLES } from "./activityCore";

/** صندوق الاعتمادات: نفس APPROVER_ROLES في السيرفر (src/lib/approvalsInbox.ts). */
export { APPROVER_ROLES as APPROVALS_PAGE_ROLES } from "./approvalsCore";
