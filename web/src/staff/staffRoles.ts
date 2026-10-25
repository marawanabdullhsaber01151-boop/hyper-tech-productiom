/** أدوار صفحات الموظفين في ملف صغير، عشان الراوتر يفحص الصلاحية من غير ما يحمّل الصفحة نفسها. */
import { SALES_ROLES } from "../admin/session";

/** نفس أدوار قايمة /nav للمشتريات + رئيس المجلس. */
export const STOCK_ROLES = ["chairman", "purchasing_manager", "buyer", "warehouse_manager", "storekeeper"] as const;

/** لازم تتطابق مع ACCESS.systemHealthRead في السيرفر. */
export const HEALTH_ROLES = ["chairman", "executive_manager"] as const;

export const SALES_PAGE_ROLES = SALES_ROLES;
