/**
 * ✅ مصفوفة الصلاحيات الموحّدة — من هنا بس، مش متكررة في كل ملف route.
 * "admin" و"manager" مسموح لهم دايمًا في كل مكان (مرحلة انتقالية للأدوار القديمة).
 * "chairman" (رئيس مجلس الإدارة) عنده رؤية لكل شيء تلقائيًا ما عدا الإعدادات والخزنة
 * (بيتحقق منها بشكل صريح في كل مصفوفة "view" تحت)، وتحكم كامل بس في المبيعات والمشتريات.
 *
 * @format
 */

export const PERMISSIONS = {
  contacts: {
    view: ["admin", "manager", "executive_manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager", "chairman"],
    write: ["admin", "manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"],
  },
  accounting: {
    view: ["admin", "manager", "hr", "hr_manager", "chairman"],
    write: ["admin", "manager", "hr", "hr_manager"],
  },
  bom: {
    view: [
      "admin",
      "manager",
      "hr",
      "hr_manager",
      "production_manager",
      "supervisor",
      "production_controller",
      "chairman",
    ],
    write: ["admin", "manager", "hr"],
  },
  inventory: {
    // ✅ hr و production_manager محتاجين "يشوفوا" المخزون بس عشان ربط مكوّنات الوصفة وتسليم المنتج التام —
    // مش عندهم صفحة المخزون نفسها، لكن محتاجين البيانات في مهامهم هم
    view: [
      "admin", "manager", "warehouse_manager", "storekeeper", "chairman",
      "hr", "hr_manager", "production_manager", "production_controller",
      "operations_manager", "raw_material_quality_controller",
    ],
    write: ["admin", "manager", "warehouse_manager", "storekeeper"],
  },
  movements: {
    view: ["admin", "manager", "warehouse_manager", "storekeeper", "chairman"],
    write: ["admin", "manager", "warehouse_manager", "storekeeper"],
  },
  purchases: {
    view: ["admin", "manager", "purchasing_manager", "buyer", "warehouse_manager", "chairman"],
    write: ["admin", "manager", "purchasing_manager", "buyer", "chairman"],
  },
  sales: {
    view: ["admin", "manager", "executive_manager", "sales_manager", "hr", "hr_manager", "online_seller", "offline_seller", "chairman"],
    write: ["admin", "manager", "executive_manager", "sales_manager", "hr", "hr_manager", "online_seller", "offline_seller", "chairman"],
  },
  hr: {
    view: ["admin", "manager", "hr", "hr_manager", "chairman"],
    write: ["admin", "manager", "hr", "hr_manager"],
  },
  production: {
    view: ["admin", "manager", "executive_manager", "operations_manager", "production_manager", "production_controller", "chairman"],
    write: ["admin", "manager", "executive_manager", "operations_manager", "production_manager", "production_controller"],
  },
  reports: {
    view: ["admin", "manager", "executive_manager", "operations_manager", "production_manager", "production_controller", "chairman"],
  },
  // ✅ إضافة: كانت ناقصة، فأي مستخدم مسجّل دخول (بأي دور) كان يقدر يضيف/يعدّل/يمسح
  // سجلات فحص الجودة عن طريق نداء مباشر للـ API — مطابق لجدول الصلاحيات في
  // README-كيفية-التركيب.md ("مراقب الجودة → صفحته بس").
  quality: {
    view: [
      "admin",
      "manager",
      "quality_controller",
      "production_quality_controller",
      "raw_material_quality_controller",
      "quality_engineer",
      "production_manager",
      "hr_manager",
      "chairman",
    ],
    write: ["admin", "manager", "quality_controller", "production_quality_controller", "raw_material_quality_controller", "quality_engineer"],
  },
} as const;
