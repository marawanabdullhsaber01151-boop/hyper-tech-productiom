/**
 * ✨ سجل الإجراءات — المصدر الوحيد اللي بيوصف كل إجراء قابل للتحكم فيه
 * في النظام (مش بس صفحة كاملة زي PERMISSIONS، لكن كل زرار/عملية لوحده).
 *
 * كل إجراء له:
 *  - key: المفتاح الثابت المستخدم في الكود (permission_overrides.action_key)
 *  - label: الاسم اللي المدير هيشوفه في شاشة إدارة الصلاحيات
 *  - group: التجميع حسب الصفحة/القسم في الواجهة
 *  - defaultRoles: الأدوار المسموح لها بيه افتراضيًا (نفس منطق requireRole
 *    الحالي) — ده اللي بيتطبّق لو مفيش أي استثناء (permission override)
 *    للمستخدم ده على المفتاح ده.
 *
 * ⚠️ قاعدة مهمة: defaultRoles هنا لازم تطابق تمامًا نفس مصفوفة PERMISSIONS
 * الحالية لكل مورد (contacts.write, sales.write...) في كل الإجراءات
 * الفرعية بتاعته (create/edit/delete). النظام الحالي مبيفرقش بين حذف
 * وتعديل — كلهم "write" واحدة، فتقسيمهم هنا لإجراءات منفصلة لازم يحافظ
 * على نفس القائمة الافتراضية بالظبط، وإلا هيغيّر صلاحيات موجودة فعليًا
 * لمستخدمين من غير ما حد يطلب ده. أي تضييق أو توسيع مقصود يتم من شاشة
 * الإدارة (استثناء لكل مستخدم) مش من هنا.
 */

export interface ActionDefinition {
  key: string;
  label: string;
  group: string;
  defaultRoles: readonly string[];
}

const CONTACTS_WRITE = ["chairman", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"] as const;
const SALES_WRITE = ["chairman", "executive_manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"] as const;
const PURCHASES_WRITE = ["chairman", "purchasing_manager", "buyer"] as const;
const INVENTORY_WRITE = ["chairman", "warehouse_manager", "storekeeper"] as const;
const MOVEMENTS_WRITE = ["chairman", "warehouse_manager", "storekeeper"] as const;
const BOM_WRITE = ["chairman", "hr", "hr_manager"] as const;
const HR_WRITE = ["chairman", "hr", "hr_manager"] as const;
const ACCOUNTING_WRITE = ["chairman", "hr", "hr_manager"] as const;
const OPERATIONS_CASE_VIEW = ["operations_manager", "executive_manager", "chairman"] as const;
const OPERATIONS_PLAN_EDIT = ["operations_manager", "executive_manager", "chairman"] as const;
const OPERATIONS_PLAN_APPROVE = ["executive_manager", "chairman"] as const;
const OPERATIONS_PLAN_DISPATCH = ["executive_manager", "chairman"] as const;

export const ACTION_REGISTRY: readonly ActionDefinition[] = [
  // ── جهات الاتصال ── (نفس PERMISSIONS.contacts.write الحالية بالظبط)
  { key: "contacts.create", label: "إضافة جهة اتصال", group: "جهات الاتصال", defaultRoles: CONTACTS_WRITE },
  { key: "contacts.edit", label: "تعديل جهة اتصال", group: "جهات الاتصال", defaultRoles: CONTACTS_WRITE },
  { key: "contacts.delete", label: "حذف جهة اتصال", group: "جهات الاتصال", defaultRoles: CONTACTS_WRITE },

  // ── المبيعات ── (نفس PERMISSIONS.sales.write الحالية بالظبط)
  { key: "sales.create", label: "إنشاء أمر بيع", group: "المبيعات", defaultRoles: SALES_WRITE },
  { key: "sales.edit", label: "تعديل أمر بيع", group: "المبيعات", defaultRoles: SALES_WRITE },
  { key: "sales.delete", label: "حذف أمر بيع", group: "المبيعات", defaultRoles: SALES_WRITE },
  { key: "sales.approve", label: "اعتماد أمر بيع", group: "المبيعات", defaultRoles: SALES_WRITE },

  // ── المشتريات ── (نفس PERMISSIONS.purchases.write الحالية بالظبط)
  { key: "purchases.create", label: "إنشاء أمر شراء", group: "المشتريات", defaultRoles: PURCHASES_WRITE },
  { key: "purchases.edit", label: "تعديل أمر شراء", group: "المشتريات", defaultRoles: PURCHASES_WRITE },
  { key: "purchases.delete", label: "حذف أمر شراء", group: "المشتريات", defaultRoles: PURCHASES_WRITE },
  { key: "purchases.approve", label: "اعتماد أمر شراء", group: "المشتريات", defaultRoles: PURCHASES_WRITE },

  // ── المخزون ── (نفس PERMISSIONS.inventory.write / movements.write الحالية بالظبط)
  { key: "inventory.create", label: "إضافة صنف مخزون", group: "المخزون", defaultRoles: INVENTORY_WRITE },
  { key: "inventory.edit", label: "تعديل صنف مخزون", group: "المخزون", defaultRoles: INVENTORY_WRITE },
  { key: "inventory.delete", label: "حذف صنف مخزون", group: "المخزون", defaultRoles: INVENTORY_WRITE },
  { key: "movements.create", label: "تسجيل حركة مخزون", group: "المخزون", defaultRoles: MOVEMENTS_WRITE },
  { key: "movements.delete", label: "حذف حركة مخزون", group: "المخزون", defaultRoles: MOVEMENTS_WRITE },

  // ── وصفات التصنيع (BOM) ── (نفس PERMISSIONS.bom.write الحالية بالظبط)
  { key: "bom.create", label: "إنشاء وصفة تصنيع", group: "وصفات التصنيع", defaultRoles: BOM_WRITE },
  { key: "bom.edit", label: "تعديل وصفة تصنيع", group: "وصفات التصنيع", defaultRoles: BOM_WRITE },
  { key: "bom.delete", label: "حذف وصفة تصنيع", group: "وصفات التصنيع", defaultRoles: BOM_WRITE },

  // ── الموارد البشرية ── (نفس PERMISSIONS.hr.write الحالية بالظبط)
  { key: "hr.create", label: "إضافة موظف", group: "الموارد البشرية", defaultRoles: HR_WRITE },
  { key: "hr.edit", label: "تعديل بيانات موظف", group: "الموارد البشرية", defaultRoles: HR_WRITE },
  { key: "hr.delete", label: "حذف موظف", group: "الموارد البشرية", defaultRoles: HR_WRITE },

  // ── المحاسبة ── (نفس PERMISSIONS.accounting.write الحالية بالظبط)
  { key: "accounting.create", label: "إضافة قيد محاسبي", group: "المحاسبة", defaultRoles: ACCOUNTING_WRITE },
  { key: "accounting.edit", label: "تعديل قيد محاسبي", group: "المحاسبة", defaultRoles: ACCOUNTING_WRITE },
  { key: "accounting.approve", label: "اعتماد قيد محاسبي", group: "المحاسبة", defaultRoles: ACCOUNTING_WRITE },

  // ── دورة الإنتاج ── (نفس أدوار requireRole الحالية في production-workflow.ts بالظبط)
  { key: "productionWorkflow.cancel", label: "إلغاء أمر إنتاج", group: "دورة الإنتاج", defaultRoles: ["executive_manager", "chairman"] },
  { key: "productionWorkflow.warehouseAction", label: "اعتماد/رفض مواد أمر إنتاج", group: "دورة الإنتاج", defaultRoles: ["warehouse_manager", "storekeeper", "operations_manager", "executive_manager", "chairman"] },
  { key: "productionWorkflow.execute", label: "تنفيذ دفعة إنتاج", group: "دورة الإنتاج", defaultRoles: ["supervisor", "production_manager", "production_controller", "operations_manager", "executive_manager", "chairman"] },
  { key: "productionWorkflow.cost.record", label: "تسجيل تكلفة إنتاج", group: "التكلفة الصناعية", defaultRoles: ["supervisor", "production_manager", "operations_manager", "executive_manager", "chairman"] },
  { key: "operations.exception.resolve", label: "إغلاق استثناء تشغيلي", group: "الاستثناءات", defaultRoles: ["production_quality_controller", "quality_engineer", "production_manager", "operations_manager", "executive_manager", "chairman"] },

  // ── Operations Control planning boundary ──
  { key: "operations.case.view", label: "عرض حالات التشغيل", group: "Operations Control", defaultRoles: OPERATIONS_CASE_VIEW },
  { key: "operations.case.edit", label: "تعديل حالة التشغيل", group: "Operations Control", defaultRoles: OPERATIONS_PLAN_EDIT },
  { key: "operations.analysis.run", label: "تشغيل تحليل تشغيلي", group: "Operations Control", defaultRoles: OPERATIONS_CASE_VIEW },
  { key: "operations.plan.create", label: "إنشاء خطة تشغيل مسودة", group: "Operations Control", defaultRoles: OPERATIONS_PLAN_EDIT },
  { key: "operations.plan.edit", label: "تعديل خطة التشغيل", group: "Operations Control", defaultRoles: OPERATIONS_PLAN_EDIT },
  { key: "operations.plan.submit", label: "إرسال خطة التشغيل للاعتماد", group: "Operations Control", defaultRoles: OPERATIONS_PLAN_EDIT },
  { key: "operations.plan.approve", label: "اعتماد خطة التشغيل", group: "Operations Control", defaultRoles: OPERATIONS_PLAN_APPROVE },
  { key: "operations.plan.dispatch", label: "تسليم خطة تشغيل معتمدة", group: "Operations Control", defaultRoles: OPERATIONS_PLAN_DISPATCH },

  // ── الإعدادات: مالك النشاط فقط مع تسجيل كل عملية في سجل التدقيق ──
  { key: "settings.manageUsers", label: "إدارة المستخدمين", group: "الإعدادات", defaultRoles: ["chairman"] },
  { key: "settings.managePermissions", label: "إدارة الصلاحيات المخصّصة", group: "الإعدادات", defaultRoles: ["chairman"] },
  { key: "governance.managePolicies", label: "إدارة سياسات الاعتماد", group: "الإعدادات", defaultRoles: ["chairman"] },
] as const;

export function findAction(key: string): ActionDefinition | undefined {
  return ACTION_REGISTRY.find((a) => a.key === key);
}
