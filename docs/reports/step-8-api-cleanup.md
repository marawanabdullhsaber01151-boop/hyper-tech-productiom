# الخطوة 8 — تنظيف مسارات الـAPI

## الأداة (إضافة جديدة)
`node scripts/api-consumers.mjs` (أو `npm run check:routes`): بيستخرج كل `router.get/post/…` ويدوّر على مستهلكه في `web/src` و`public/` و`scripts/` والاختبارات.
- `used` / `weak` (آخر جزء من المسار بس) / `tests-only` / `none`.
- `--check` بيفشل لو ظهر مسار بدون مستهلك ومش مصنّف في `docs/api-routes-allowlist.json` — يعني مفيش مسار يتيم يدخل المشروع بصمت. اتضاف لـ`check:all`.

## اتشال (مؤكد: صفر مستهلكين، وله بديل)
| المسار | البديل |
|---|---|
| `POST /portal/forgot-password`, `POST /portal/otp/request`, `POST /portal/otp/verify` | `/portal/recovery/*` |
| `GET /portal-customers/password-reset-requests` | لا حاجة (مفيش طابور يدوي) |
| `PATCH /portal-customers/:id/reset-password` (كلمة مؤقتة بتتبعت صريحة) | `admin-code` و`reset-link` |
| `POST /portal/recovery/use-recovery-code` (alias) | `/portal/recovery/verify` |
| `GET/PUT /portal-settings` | `/portal-admin/settings` |
| `PATCH /portal-applications/:id/needs-info` | `POST /portal-admin/applications/:id/request-info` |
مع تنظيف ما بقى غير مستخدم (`otpRequestRateLimiter`، `sendOtpCode`، متغيّرات `PORTAL_OTP_*`، كتلة تعليق التسجيل القديم).

## اتقفل/اتصنّف بدل الحذف
- `GET /chat/cron/maintenance`: Vercel cron — لازم يفضل.
- مسارات تشخيص (ops)، ومسارات ميزات بدون شاشة (backlog)، ومسارات مغطّاة باختبارات فقط، و`POST /portal/register` (410 عمدًا).
- `assigned-sales`: ناقصة واجهة في v2 (KNOWN_ISSUES #26).
- `/portal-applications/:id/approve` فضل لأن 6 اختبارات e2e بتستخدمه كمساعد.

## صفحات قديمة
كل روابط `index.html` بقت `/v2/staff`، واتشال توجيه ميت في `nav-loader.js`.

## ما اتفحصش هنا
اختبارات e2e (محتاجة قاعدة بيانات) ما اتشغلتش في بيئتي؛ الجداول فضلت من غير هجرة حذف.
