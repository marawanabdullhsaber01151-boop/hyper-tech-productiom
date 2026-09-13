/**
 * ✅ قائمة الأدوار الموحّدة في النظام كله — مصدر واحد بدل التكرار.
 *
 * القائمة التالية هي الأدوار التشغيلية المعتمدة فقط.
 * الأدوار العامة القديمة (admin, manager, user, quality_controller) أُزيلت
 * نهائيًا حتى لا يحصل أي مستخدم على صلاحيات عامة غير محددة.
 *
 * لما يتقرر نظام الصلاحيات النهائي، القائمة دي هي المكان الوحيد اللي هيتعدل.
 *
 * @format
 */

export const USER_ROLES = [
  "chairman", // رئيس مجلس الإدارة — تحكم كامل في النظام مع سجل تدقيق
  "executive_manager", // المدير التنفيذي — تشغيل وإدارة بدون الإعدادات
  "sales_manager", // مدير المبيعات
  "online_seller", // بائع الأونلاين
  "offline_seller", // بائع الأوفلاين
  "operations_manager", // مدير التشغيل — الوسيط الإلزامي بين المخزن والإنتاج
  "purchasing_manager", // مدير المشتريات
  "buyer", // المشتري
  "supervisor", // مشرف الإنتاج
  "production_controller", // مراقب الإنتاج الخاص بالوحدة
  "hr", // موارد بشرية — نقطة استقبال طلبات العملاء + محاسبة + عملاء وموردين + وصفات التصنيع
  "hr_manager", // مدير الموارد البشرية
  "production_manager", // مدير الإنتاج
  "warehouse_manager", // مدير المخازن
  "storekeeper", // أمين المخزن
  "production_quality_controller", // مراقب جودة دورة الإنتاج
  "raw_material_quality_controller", // مراقب جودة الخامات قبل دخول المخزن
  "quality_engineer", // مهندس الجودة
] as const;

export type UserRole = (typeof USER_ROLES)[number];
