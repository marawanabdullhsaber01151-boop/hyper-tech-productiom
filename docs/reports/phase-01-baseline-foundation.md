# تقرير المرحلة 01 — baseline قابل للتشغيل

## ما تم تثبيته

أصبحت المرحلة تحتوي على حدود تشغيل واضحة بدل الاعتماد على وجود ملفات تحمل
أسماء مشابهة:

- migration runner مرتب مع checksum ومدة تنفيذ وتراجع transaction لكل ملف.
- preflight مستقل يوقف التنفيذ عند duplicate migration أو checksum drift.
- correlation ID موحد في الطلبات، الاستجابات، والسجلات.
- عقد mutation قياسي يدعم `Idempotency-Key` و`If-Match-Version` وسياق actor.
- أربع طبقات metadata فقط: سجل migrations، فحوصات الصحة، idempotency commands،
  ونتائج data audit.
- شاشة RTL للإدارة تعرض حالة migrations، الإعدادات الناقصة، findings، وسبب
  عدم توفر الميزة.

## نقطة البيانات

`production_orders` لا يزال legacy. سكربت `npm run audit:phase1` يقرأ ولا يحذف،
ويصنف:

1. صفوف legacy وأوضاعها.
2. أوامر `production_workflow_orders` الحالية.
3. الحالات المفتوحة في `operations_cases`.
4. master data النشطة.
5. مراجع FK اليتيمة.

لا يبدأ ترحيل صف واحد قبل backup ونتيجة هذا التقرير ومراجعة external callers.

## حدود الإثبات

التحقق الثابت متاح عبر `npm run check:repository` و`npm run db:preflight`.
التحقق من PostgreSQL، migration rerun، seed/login، readiness الحقيقي، وE2E
يتطلب `DATABASE_URL` وبيئة اختبار فعلية؛ لا يُعد ناجحًا من مجرد وجود الكود.