# Hyper-Tech ERP — Project Status

## الحالة الحالية

- المرحلة 00: مكتملة توثيقيًا.
- المرحلة 01: طبقة baseline والتنفيذ الآمن مضافة: migration ledger مع checksums،
  preflight، correlation IDs، idempotent command contract، شاشة صحة النظام،
  وتدقيق بيانات legacy غير هدّام. ما زال فحص PostgreSQL الفعلي وترحيل
  `production_orders` مؤجلين إلى ما بعد backup وdata audit.
- المرحلة 02: مكتملة كطبقة نقل متوافقة؛ كل استجابات API تمر عبر envelope موحّد،
  وأخطاء auth وvalidation وHTTP لها codes ثابتة، مع إبقاء payloads القديمة داخل
  `data` حتى لا تنكسر الصفحات الحالية.
- المرحلة 03: مكتملة برمجيًا؛ شاشة Foundation والتحقق والعدادات والتحويلات وربط
  الأصناف بالمخزون موجودة. يتبقى فقط تشغيل migration وفحص البيانات على قاعدة
  فعلية قبل إغلاق الترحيل التشغيلي.
- تم توحيد مراحل دورة الإنتاج الإحدى عشرة كطبقة تشغيلية فوق حالات أمر الإنتاج،
  مع API ولوحة مرئية داخل صفحة أوامر الإنتاج. هذا لا يلغي أي جدول أو route قديم.
- المرحلة 04 (التصميم الهندسي ودورة حياة المنتج) مضافة برمجيًا: منتجات هندسية،
  إصدارات BOM/Routing، عمليات التشغيل، وطلبات تغيير ECR. يلزم تشغيل migration
  `0022_engineering_product_lifecycle.sql` قبل استخدام هذه المسارات.
- تم إضافة طبقة التشغيل الفعلي: تأكيدات العمليات، موازنة الدفعات، التوقفات،
  NCR، والتتبع بالـLot. يلزم تشغيل migration
  `0023_production_execution_quality_traceability.sql`.
- تم إضافة التخطيط وMRP: حساب المتاح بعد خصم المحجوز والمحجور، استخراج العجز
  الصافي، وإنشاء طلب شراء مرتبط بالخطة. يلزم تشغيل migration
  `0024_planning_mrp_quarantine.sql`.
- تم ربط كل وظائف الطبقات المضافة بمركز تحكم Frontend جديد:
  `public/production-control.html` مع JavaScript وCSS خاصين به، ويغطي
  المنتجات والإصدارات وRouting وMRP وطلبات الشراء والدفعات والتوقفات وNCR
  والتتبع.

## آخر نقطة تنفيذ فعلية

إضافة `public/foundation.html` و`public/JS/foundation.js` و
`public/CSS/foundation.css` وربطها بـ:

`/foundation/summary`, `/foundation/items`, `/foundation/locations`,
`/foundation/work-centers`, `/foundation/machines`, `/foundation/shifts`,
`/foundation/transitions`, `/foundation/audit`.

## القيود المعروفة

لا توجد `DATABASE_URL` متصلة داخل النسخة المرفوعة، لذلك لا يمكن إثبات سلامة
البيانات الموجودة أو تنفيذ migration على بيانات فعلية من داخل هذه الحزمة.
لتطبيق إصلاح 500 على deployment موجود شغّل:

```bash
npm run db:migrate:foundation
```

وذلك بعد ضبط `DATABASE_URL`. الأمر idempotent ويستخدم transaction واحدة.

## الخطوة التالية

تشغيل `npm run db:migrate:foundation` بعد أخذ backup وفحص
`foundation_items` و`inventory_items`، ثم بدء المرحلة 04.

## إضافة دورة الإنتاج

الملفات الجديدة:

- `src/domain/production-cycle.ts`
- `src/domain/production-cycle.test.ts`
- `src/routes/production-cycle.ts`

المسارات الجديدة:

- `GET /api/v1/production-cycle/stages`
- `GET /api/v1/production-cycle/dashboard`

يتم اشتقاق المرحلة الحالية من `workflowStatus` و`currentStage`، لذلك لا توجد
هجرة قاعدة بيانات مطلوبة لهذه الإضافة.

## المرحلة 04 — التصميم الهندسي ودورة حياة المنتج

المسارات الجديدة:

- `GET/POST /api/v1/engineering/products`
- `GET /api/v1/engineering/products/:id`
- `POST /api/v1/engineering/products/:id/versions`
- `POST /api/v1/engineering/bom-versions/:id/approve`
- `POST /api/v1/engineering/routings/:versionId/operations`
- `GET/POST /api/v1/engineering/change-requests`

تحفظ المرحلة `bomSnapshot` و`routingSnapshot` داخل إصدار المنتج حتى لا تتغير
مواصفات أمر قديم تلقائيًا عند إنشاء إصدار جديد.

## طبقة التشغيل الفعلي والجودة والتتبع

المسارات الجديدة:

- `PATCH /api/v1/production-execution/batches/:id/confirm`
- `PATCH /api/v1/production-execution/batches/:id/close`
- `GET/POST /api/v1/production-execution/batches/:id/downtimes`
- `GET/POST /api/v1/production-execution/ncrs`
- `POST /api/v1/production-execution/traceability`
- `GET /api/v1/production-execution/traceability/:lotNumber`

لا يمكن إغلاق الدفعة إلا بعد تحقق القاعدة:
`produced = accepted + rework + scrap`، ولا يمكن أن تتجاوز الكمية المنتجة
الكمية المخططة.

## التخطيط وMRP

المسارات الجديدة:

- `POST /api/v1/planning/mrp`
- `GET /api/v1/planning/mrp`
- `POST /api/v1/planning/requisitions`

يحسب MRP الكمية المتاحة كالتالي:
`qty - reservedQty - quarantineQty`، ولا يحوّل الكمية المحجورة إلى مخزون
قابل للاستهلاك.