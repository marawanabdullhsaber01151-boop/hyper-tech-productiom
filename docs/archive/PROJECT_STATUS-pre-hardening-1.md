<!-- @format -->

# Hyper-Tech ERP — Project Status

## الحالة الحالية

- المرحلة 00: مكتملة توثيقيًا.
- المرحلة 01: طبقة baseline والتنفيذ الآمن مضافة: migration ledger مع checksums،
  preflight، correlation IDs، idempotent command contract، شاشة صحة النظام،
  وتدقيق بيانات legacy غير هدّام. ما زال فحص PostgreSQL الفعلي وترحيل
  `production_orders` مؤجلين إلى ما بعد backup وdata audit.
- المرحلة 02: ت
م تسليم طبقتي الهوية canonical ودورة الحياة. أوامر الإنتاج
  الجديدة تُنشأ من `production_workflow_orders` مع snapshots وبصمة مصدر، وتوجد
  انتقالات محمية بالـrevision، سجلات adjustment صريحة، تحويل idempotent من
  Operations Case، شاشة تفاصيل بالـgates والـtimeline، وفحص conformance وتدقيق
  legacy مع quarantine غير هدّام. لا يُعتبر ترحيل قاعدة فعلية أو happy-path
  E2E مثبتًا قبل تشغيله على بيئة الإنتاج.
  **تسليم 3:** أُغلقت ثغرة كان فيها مساران منفصلان للإلغاء — المسار القديم
  `PATCH /production-workflow/:id/cancel` (وهو الوحيد اللي بيرجّع حركات
  المخزون المخصومة) والمسار العام `POST /production-workflow/:id/transition`
  (بيبني adjustment وrevision لكن من غير عكس مخزون). المسار العام بقى يرفض
  `targetStatus: "cancelled"` صراحة برسالة توجّه لمسار الإلغاء المخصص، وأصبح
  الإلغاء عبر المسار القديم يتطلب `reason` إجباري ويُسجَّل على نفس سجل
  `production_lifecycle_adjustments` الذي يستخدمه مسار الـtransition العام،
  فتظهر عمليات الإلغاء كلها في نفس الـtimeline بغض النظر عن أي مسار استُخدم.
  التفاصيل الكاملة في `docs/reports/phase-02-canonical-domain-part-3.md`.
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

## المرحلة 03 — بيانات تأسيسية محكومة (governed master data)

**تسليم 2:** حارس منع كسر العمل الجاري عند إلغاء التفعيل — أصناف/مواقع/مراكز
عمل. أي محاولة `PATCH .../:id {active:false}` وفيها مرجع نشط (أرصدة مخزون،
مواقع/مراكز فرعية نشطة، ماكينات نشطة) تُرفض بـ `409 INACTIVATION_BLOCKED`
مع تفاصيل المراجع، إلا لو أُرسل `overrideReason` صريح يُسجَّل في
`foundation_audit`. الواجهة (`foundation.html`) عندها الآن زرار
تفعيل/إلغاء تفعيل لأول مرة (ماكانش موجود أصلاً).

**تسليم 3:** طبقة حوكمة كاملة فوق `foundation_items` (migration 0063):
حالات دورة حياة (draft → pending_approval → active → superseded/retired)،
تاريخ إصدارات (`foundation_item_versions`، لقطة قبل كل تغيير)، أسماء بديلة
(`foundation_item_aliases`)، uniqueness غير حساس لحالة الأحرف على الكود مع
حارس أمان لا يفشل الـmigration لو فيه تكرار موجود مسبقًا (يسجّله في جدول
مراجعة بدل ما يوقف كل التغييرات الأخرى)، وكشف تكرار بالاسم عبر عمود
`name_normalized` **مولَّد داخل قاعدة البيانات ومفهرس** (أداء: GROUP BY
مفهرس بدل سحب كل الصفوف للتطبيق). تغييرات وحدة القياس/نوع الصنف/الحد
الأدنى على صنف نشط لازم تعدّي بـ`request-change → approve/reject`
(صلاحية الاعتماد أضيق من صلاحية التعديل العادية). مسار استيراد محدود
بـ500 صف، dry-run افتراضي، وكل الدفعة أو لا شيء منها. تفاصيل كاملة في
`docs/reports/phase-03-foundation-part-3.md`.

**ملاحظة تصحيح:** في نفس التسليم 3 اكتُشف أن `foundationItemSchema` (ومثيلاتها
للمواقع/مراكز العمل) ماكانتش بتعرّف حقل `active` أصلاً، يعني زرار
تفعيل/إلغاء تفعيل من تسليم 2 كان بيُرسَل لكنه يُتجاهَل بصمت (zod بيحذف أي
حقل غير معرّف في `.partial().parse()`) — الحقل اتضاف للـ3 schemas في نفس
هذا التسليم.

**لسه مفتوح من نطاق المرحلة 03 الكامل حسب دليل الـroadmap:** نفس طبقة
الحوكمة دي لسه مطبّقة على `foundation_items` بس، مش على المواقع/مراكز
العمل/الماكينات/الورديات؛ effective dating موجود كحقول في القاعدة لكن
مفيش تطبيق فعلي لسريان/انتهاء الصلاحية في منطق التطبيق بعد؛ واجهة
الـworkspace الكاملة (tabs محفوظة، رسم بياني للتبعيات) لسه شاشة CRUD
عامة واحدة، مش الشاشة الغنية اللي وصفها الـroadmap. التفاصيل الكاملة
والقائمة الأولوية في `docs/reports/phase-03-foundation-part-3.md`.

## المرحلة 04 — دورة حياة الهندسة (BOM وRouting)

**اكتشاف مهم:** أوامر الإنتاج بتتبنى بالكامل من جدول `bom_recipes` القديم
غير المحكوم (مفيش فيه حالة/إصدار/اعتماد أصلًا) — مش من وحدة
`engineering_products/engineering_product_versions` الموجودة فعلًا من
migration 0022. الوحدتين منفصلتين تمامًا، رغم إن وحدة الهندسة موجودة
ومُوصّلة (mounted) وليها شاشة.

**تسليم 1:** حوكمة حقيقية داخل وحدة الهندسة نفسها (من غير المساس بمسار
إنشاء أوامر الإنتاج الفعلي، لخطورة إعادة التوصيل دي بدون قاعدة بيانات
حقيقية للاختبار عليها): مكوّنات BOM منظّمة بدل الـjsonb الحر (جدول
`engineering_bom_components`)، آلة حالات كاملة
(draft→in_review→approved→released→superseded/retired)، منع التعديل بعد
الاعتماد، فحص قابلية تصنيع حقيقي (كشف دوائر في الـBOM، وحدات مفقودة، مواد
غير نشطة، كميات مستحيلة، عمليات مكررة، مراكز عمل مفقودة) لازم ينجح قبل
الاعتماد، وتجميد لقطة غير قابلة للتعديل عند الإصدار النهائي (release).
تفاصيل كاملة، وأهم حاجة فيها — الفجوة بين وحدة الهندسة والإنتاج الفعلي —
في `docs/reports/phase-04-engineering-part-1.md`.

**لسه ناقص:** إعادة توصيل إنشاء أوامر الإنتاج لتستهلك من
`engineering_product_versions` بدل `bom_recipes` (ده الأساس اللي يخلي
معيار "بس إصدار هندسي معتمد يقود العمل" صحيح فعليًا)؛ محرر BOM/routing
بصري؛ شجرة الإصدارات ومقارنة الفروقات؛ تقويم سريان الصلاحية.

## تقوية الأمان — قفل الحساب + مصادقة ثنائية (2FA)

راجعت نظام تسجيل الدخول الموجود قبل ما أعمل حاجة — لقيته فعلًا قوي:
جلسات متحقق منها من قاعدة البيانات في كل طلب (مش JWT بيتصدّق لوحده لحد 7
أيام)، سجل تدقيق متسلسل بالهاش (كل صف بيحمل هاش الصف اللي قبله، فأي تعديل
أو حذف بيتكشف)، helmet+CSP حقيقي، rate limiting على تسجيل الدخول.

اللي كان ناقص فعليًا وقفلته:

1. **قفل حساب حقيقي** بعد 5 محاولات فاشلة (15 دقيقة) — منفصل عن حماية
   الـIP الموجودة، وبيسجّل كل محاولة فاشلة في سجل التدقيق (ماكانش بيتسجّل
   خالص قبل كده).
2. **مصادقة ثنائية (2FA) بمعيار TOTP** (نفس اللي بيستخدمه Google
   Authenticator) — اختيارية لكل مستخدم من صفحة الإعدادات → حسابي
   الشخصي، بدون أي مكتبة خارجية جديدة (اتبنت بـcrypto المدمج في Node
   وتم التحقق منها فعليًا ضد القيم المرجعية الرسمية لمعيار RFC 6238 قبل
   استخدامها في أي مكان). فيها أكواد احتياطية لو ضاع الموبايل.

التفاصيل الكاملة، وأهم حاجة فيها — القيود المعروفة (مفيش QR حقيقي، مفيش
إجبار إداري على 2FA لسه) — في `docs/reports/security-hardening-2fa.md`.
