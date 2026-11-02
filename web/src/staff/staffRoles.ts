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
/** التخطيط: نفس planningRoles في السيرفر. */
import { PLANNING_ROLES } from "./planningCore";
export const PLANNING_PAGE_ROLES: readonly string[] = PLANNING_ROLES;

export const ENGINEERING_PAGE_ROLES = [...new Set([...ENGINEERING_ROLES, ...RECIPE_VIEW_ROLES])] as readonly string[];

export const OPERATIONS_ROLES = ["chairman", "executive_manager", "operations_manager"] as const;
