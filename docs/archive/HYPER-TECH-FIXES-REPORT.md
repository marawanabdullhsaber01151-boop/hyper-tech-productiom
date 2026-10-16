# تقرير إصلاحات Hyper-Tech ERP

## نطاق الإصلاح

تم تنفيذ إصلاحات قسم المدير التشغيلي ومسارات المبيعات والبوابة وكتالوج المنتجات، مع الحفاظ على بنية المشروع الحالية واستخدام `npm` كما هو معرف في المشروع.

## أهم التعديلات

- تركيب `operations-manager` مباشرة في `src/main.ts` وإزالة التركيب الداخلي المكرر من `operations-control.ts`.
- إضافة اختبار تكامل لمسار:
  - `GET /api/v1/operations-manager/cases`
- إضافة رابط شاشة **مراجعة واستقبال أوامر البيع التشغيلية** للأدوار التي تملك صلاحية استقبال الحالات، مع عداد حالات `received` مخزّن مؤقتًا لمدة قصيرة وباستعلام واحد عند الحاجة.
- تحديث عنوان شاشة المدير التشغيلي وإظهار عداد الحالات في التنقل.
- استكمال انتقالات البيع المباشرة إلى `shipped` و`paid` مع إنشاء حركة خروج مخزون فعلية، ومعالجة انتقال `confirmed → paid` بتحرير الحجز ثم الخصم الفعلي.
- منع استقبال أمر بيع في حالة `shipped` أو `paid` إذا لم توجد حركة خروج مرتبطة بكل بند مخزني، مع:
  - استجابة JSON منظمة.
  - تفاصيل البنود الناقصة.
  - تسجيل حدث تدقيق بالرفض.
- نقل فحص مراجعة إرسالية البوابة إلى داخل المعاملة، مع تحويل تعارض السباق على القيد الفريد إلى `409` بدل خطأ قاعدة بيانات عام.
- إضافة `is_active` لوصفات التصنيع مع migration جديدة.
- تحديث بوابة العملاء لتعرض المنتجات النشطة فقط، ومنع إضافة أو إرسال منتج متوقف.
- إضافة زر تفعيل/إيقاف المنتج وشارة الحالة في شاشة إدارة الوصفات.
- إضافة مفتاح idempotency لإرسال طلبات البوابة والتحقق من الكمية والملاحظات.

## الملفات الجديدة

- `migrations/0040_bom_recipe_active.sql`
- `migrations/0041_portal_order_submission_integrity.sql`
- `src/routes/operations-manager.mount.test.ts`
- `HYPER-TECH-FIXES-REPORT.md`

## الملفات المعدّلة

- `src/main.ts`
- `src/routes/operations-control.ts`
- `src/routes/operations-manager.ts`
- `src/routes/sales.ts`
- `src/lib/operations-intake.ts`
- `src/lib/operations-intake.test.ts`
- `src/lib/departments.ts`
- `src/routes/nav.ts`
- `src/routes/portal-orders.ts`
- `src/routes/portal-orders.test.ts`
- `src/routes/portal.ts`
- `src/db/schema/bom.ts`
- `src/db/schema/index.ts`
- `public/operations-manager.html`
- `public/JS/nav-loader.js`
- `public/JS/portal.js`
- `public/JS/bom.js`
- `public/CSS/style.css`
- `public/CSS/bom.css`

## نتائج التحقق

### Build

```text
npm run build
✓ تم إنشاء dist/index.mjs بنجاح
```

### Tests

```text
npm test
✓ Test Files: 22 passed
✓ Tests: 96 passed
↪ 3 skipped
```

## ملاحظات التشغيل

بعد تجهيز قاعدة البيانات، شغّل migrations المشروع بالطريقة المعتادة:

```bash
npm run db:migrate
```

أثناء تثبيت dependencies ظهر تحذير `npm audit` عن 4 ثغرات متوسطة في dependencies موجودة بالمشروع. لم يتم تشغيل `npm audit fix --force` لتجنب تحديثات كاسرة غير مطلوبة ضمن هذه المهمة.