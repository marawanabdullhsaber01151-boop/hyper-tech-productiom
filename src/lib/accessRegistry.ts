/** @format */
/**
 * سجل الوصول — مصدر واحد لأدوار القراءة اللي أكتر من حاجة بتعتمد عليها.
 *
 * ليه موجود: كان عندنا ٣ جداول صلاحيات بتتعدّل كل واحد لوحده (قايمة الصفحات، حارس كل صفحة، وحراسة الـAPI)
 * ومفيش حاجة بتتأكد إنهم متطابقين. النتيجة: دور يشوف صفحة في القايمة وصفحته تنادي بيانات ممنوعة عنه،
 * فيظهر له «تعذّر تحميل بيانات» (الرئيس بيعدّي من كل حارس فمكانش بيشوف المشكلة).
 *
 * القاعدة: أي راوت بيتحمّل في صفحة أساسية لازم تتحدد أدواره هنا، والراوت والاختبار والواجهة كلهم يقروا من هنا.
 */
import { PERMISSIONS } from "./permissions";
import type { UserRole } from "./roles";

const uniq = (roles: readonly UserRole[]): UserRole[] => [...new Set(roles)];

export const ACCESS = {
  /**
   * المخزون (قراءة). المبيعات كان ليهم كود مخصص في الراوت (salesOnly) لكن الحراسة كانت بتمنعهم،
   * فصفحة المبيعات كلها كانت بتفشل. الحقول الحساسة بتتخفي حسب الدور (fieldMasking).
   */
  inventoryRead: uniq([
    ...PERMISSIONS.inventory.view,
    "sales_manager",
    "online_seller",
    "offline_seller",
    "executive_manager",
    "supervisor",
    "production_quality_controller",
    "quality_engineer",
  ]),

  /** أوامر الإنتاج (قراءة القايمة). الجودة مضافة لأن صفحة مراقب الجودة بتحمّلها. بيانات العميل بتتخفي عن أدوار الأرضية. */
  productionWorkflowRead: uniq([
    "chairman",
    "executive_manager",
    "operations_manager",
    "sales_manager",
    "hr",
    "hr_manager",
    "production_manager",
    "production_controller",
    "warehouse_manager",
    "supervisor",
    "production_quality_controller",
    "quality_engineer",
    "raw_material_quality_controller",
  ]),

  /** لوحة التحكم الرئيسية (مؤشرات مالية وجودة). */
  dashboardRead: uniq(["chairman", "executive_manager", "operations_manager", "production_manager", "production_controller"]),

  /** مراحل دورة الإنتاج (أعداد وأرقام أوامر بدون بيانات عملاء). كل دور بيشوف صفحة الإنتاج لازم يشوفها. */
  productionCycleRead: uniq([
    "chairman",
    "production_manager",
    "warehouse_manager",
    "supervisor",
    "production_quality_controller",
    "operations_manager",
    "production_controller",
    "executive_manager",
  ]),

  /** صفحة «التحكم في العمليات» وواجهاتها. */
  operationsControl: uniq(["chairman", "executive_manager", "operations_manager"]),

  /** صفحة «صحة النظام»: تفاصيل أمنية وتشغيلية، فهي للإدارة العليا بس. */
  systemHealthRead: uniq(["chairman", "executive_manager"]),
} as const;

export type AccessKey = keyof typeof ACCESS;

/** إيه اللي الدور ده يقدر يقراه — الواجهة بتستخدمه عشان تحمّل المسموح بس وما تعرضش أخطاء لشيء مش من حقه. */
export function capabilitiesFor(role: string): Record<AccessKey, boolean> {
  const out = {} as Record<AccessKey, boolean>;
  for (const key of Object.keys(ACCESS) as AccessKey[]) {
    out[key] = role === "chairman" || (ACCESS[key] as readonly string[]).includes(role);
  }
  return out;
}
