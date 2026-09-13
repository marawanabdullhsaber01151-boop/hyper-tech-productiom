# تقرير المرحلة 01 — حسم نموذج الإنتاج

## القرار

تم اعتماد `production_workflow_orders` كمصدر الحقيقة الوحيد لأوامر الإنتاج.

## ما تم تنفيذه

- كل شاشات الإنتاج الحالية تستخدم `/production-workflow`.
- Dashboard والتخطيط والبوابة تنشئ وتقرأ workflow orders.
- تم إلغاء تسجيل legacy router من `src/index.ts`.
- تم حذف wrapper الخاص بـ `productionOrders` من `public/JS/api-client.js`.
- تمت إضافة حالات الإنتاج والانتقالات الرسمية في `src/domain/production-status.ts`.
- تمت إضافة عقود الإنتاج في `src/domain/production-contracts.ts`.
- تمت إضافة اختبارات للحالات والانتقالات غير المسموحة.
- تم توثيق القرار في `docs/production-domain-decision.md`.

## ما لم يُحذف

تم الإبقاء مؤقتًا على `src/routes/production.ts` و
`src/db/schema/production.ts` وجدول `production_orders` لأغراض فحص وترحيل
البيانات فقط. لا توجد كتابة جديدة إليه من التطبيق بعد إلغاء تسجيل الراوتر.

## فحوصات المرحلة

- لا توجد استدعاءات Frontend إلى `/production-orders`.
- route القديم غير mounted.
- حالات الدورة الرسمية لها اختبار وحدة.
- لا يتم حذف الجدول قبل data audit وmigration وbackup/restore verification.

## المؤجل

- فحص بيانات `production_orders` في قاعدة فعلية.
- ترحيل الصفوف المطلوبة إلى `production_workflow_orders`.
- إثبات عدم وجود external callers.
- حذف جدول/schema/route legacy بعد نجاح الترحيل.

## نقطة الاستكمال

- آخر شيء تم إنجازه: تثبيت workflow كمصدر الحقيقة وإيقاف legacy router.
- آخر ملف تم تعديله: `src/index.ts`.
- آخر function تم تعديلها: تسجيل routers في `apiRouter`.
- المهمة التالية بالترتيب: data audit للجدول القديم ثم migration plan.
- الأوامر المطلوبة للتحقق: `pnpm --filter @workspace/api-server run test` و`pnpm --filter @workspace/api-server run build`.
- البيانات المطلوبة: عدد legacy rows وعلاقاتها ومقابل كل صف في workflow.
- المشكلة المؤجلة: لا توجد قاعدة بيانات متصلة في بيئة الفحص.
- القرار المطلوب من صاحب المشروع: الموافقة على ترحيل legacy rows بعد ظهور نتيجة data audit.