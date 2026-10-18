/** @format */
import type { UserRole } from "./roles";

/** اسم الدور بالعربي — بيظهر في هيدر الموظفين (/nav → user.roleLabel). */
export const ROLE_LABELS: Record<UserRole, string> = {
  chairman: "رئيس مجلس الإدارة",
  executive_manager: "المدير التنفيذي",
  sales_manager: "مدير المبيعات",
  online_seller: "بائع الأونلاين",
  offline_seller: "بائع الأوفلاين",
  operations_manager: "مدير التشغيل",
  purchasing_manager: "مدير المشتريات",
  buyer: "المشتري",
  supervisor: "مشرف الإنتاج",
  production_controller: "مراقب الإنتاج",
  hr: "الموارد البشرية",
  hr_manager: "مدير الموارد البشرية",
  production_manager: "مدير الإنتاج",
  warehouse_manager: "مدير المخازن",
  storekeeper: "أمين المخزن",
  production_quality_controller: "مراقب جودة الإنتاج",
  raw_material_quality_controller: "مراقب جودة الخامات",
  quality_engineer: "مهندس الجودة",
};

export function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role;
}
