<!-- @format -->

# Hyper-Tech Production Portal

نظام B2B للجملة والمصنع: بوابة عملاء (تصفّح، طلب، متابعة) من ناحية، ومسار تشغيل داخلي
(استلام ← إنتاج ← جودة ← تسليم) من الناحية التانية.

**الاسم مؤقت** (placeholder) لحد ما الاسم/الدومين النهائي يتحدد.

## المصدر المرجعي
- **الخطة والمواصفات:** `Handoff-package` (docs/handoff) — هي المرجع. أي تعارض بين الكود والخطة يتسجّل في `docs/reports/` ويتحسم مع صاحب المشروع.
- **حالة المشروع الفعلية:** `docs/PROJECT_STATUS.md`، والمشاكل المعروفة في `docs/KNOWN_ISSUES.md`.
- **تقارير التسليمات:** `docs/reports/` (كل تسليم له تقرير)، والأرشيف القديم في `docs/archive/`.

## الستاك
- **Backend:** Express 5 + TypeScript + PostgreSQL (Drizzle ORM)، هجرات SQL عادية في `migrations/` بتتنفذ بالترتيب عبر `npm run db:migrate`.
- **Frontend الجديد:** Preact + Vite في `web/` (يُخدم على `/v2`). **الواجهات القديمة:** HTML/JS ثابت في `public/` (بتتنقل تدريجيًا).
- **الاستضافة:** Vercel (API + static) + Neon (PostgreSQL).

## تشغيل محلي
```bash
npm ci --include=dev
cp .env.example .env      # املأ DATABASE_URL والأسرار (التفاصيل جوه الملف)
npm run db:migrate
npm run db:seed           # بيعمل أول مستخدم admin
npm run dev
```

## الجودة (قبل أي تسليم)
```bash
npm run check:all         # tsc سيرفر+ويب، اختبارات الوحدة والويب، build كامل (لينت/ميزانيات/تباين)
npm run check:e2e         # اختبارات HTTP + Postgres (لازم قاعدة مرّت بكل الهجرات)
npm run delivery:pack -- --phase <اسم> --base <git-ref>   # حزمة التسليم
npm run delivery:verify -- --dir delivery/<اسم>           # التحقق بعد النسخ
```

## أمان البيانات
- ممنوع إضافة نسخ احتياطية أو تفريغات بيانات حقيقية للمستودع (`.gitignore` بيمنع `*backup*.json` و`*.dump` و`*.zip`).
- `audit_events` سجل غير قابل للتعديل (هجرة 0077)؛ الصيانة المعتمدة بس عبر `SET LOCAL hypertech.audit_maintenance = 'on'`.
