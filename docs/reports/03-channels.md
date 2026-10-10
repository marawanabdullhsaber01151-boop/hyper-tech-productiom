# تقرير خطة 03 — القنوات والتفعيل واستعادة كلمة السر

## اللي اتعمل
- **طبقة إرسال واحدة** (`src/lib/channels/`): النية ← السياسة ← المحوّلات ← الـ outbox.
  - المحوّلات: إيميل (SMTP عبر nodemailer، أو Brevo/Resend)، تيليجرام (بوت)، SMS (المحوّل القديم)، واتساب يدوي (رابط wa.me).
  - الاستراتيجية من الإعدادات: `delivery.strategy` = أول قناة تنجح | كل القنوات المتأكدة | يدوي بس. والقنوات لكل غرض: `delivery.activation.channels` / `delivery.recovery.channels` / `delivery.alert.channels`.
  - الـ outbox صريح: `sent` بس لو المحوّل فعلاً بعت. الواتساب اليدوي `manual_pending` وبعدها `manual_sent` لما الموظف يأكد.
  - أي رسالة تفعيل من الإدارة بترجّع دايماً رابط واتساب احتياطي + نص الرسالة.
- **توكنات**: `portal_auth_tokens` (32 byte عشوائي، بنخزّن sha256 بس). الأكواد القصيرة (8 أرقام) HMAC بـ pepper مربوط بالمستخدم، 5 محاولات، مقارنة ثابتة الزمن، الاستهلاك ذرّي.
- **التفعيل**: `POST /portal/activate/preview` (من غير استهلاك)، و`/portal/activate` بيرجّع 8 أكواد استرجاع مرة واحدة، وبيأكّد الإيميل لو الرابط وصل عليه فعلاً. الروابط القديمة (`portal_activation_tokens`) لسه شغالة.
- **الاستعادة** (ردود موحّدة، مفيش كشف لوجود الحساب): رابط على إيميل/تيليجرام متأكدين، كود إدارة (8 أرقام، ~10 دقايق، مرة واحدة)، كود استرجاع، أو رئيس الشركة (إشعار + رابط للموظف).
- بعد أي تغيير/استعادة: كل الجلسات بتتقفل، وتنبيه أمني بيتبعت على القنوات المتأكدة.
- **القنوات الشخصية**: `GET/DELETE /portal/me/channels`، إضافة إيميل بكود تأكيد، ربط تيليجرام بـ `/start <token>` عبر webhook محمي بـ `X-Telegram-Bot-Api-Secret-Token`.
- **الإدارة**: زرار «كود إدارة» في صفحة عملاء البوابة، `GET /portal-admin/channels/status`، `POST /portal-admin/channels/email/test`، `POST /portal-outbox/:id/mark-sent`، `GET /portal-customers/:id/outbox`.
- **واجهة بسيطة (قديمة)**: صفحة `portal-recover.html`، وصفحة التفعيل بتعرض أكواد الاسترجاع وبتخدم رابط الاستعادة. الواجهة الجديدة (v2) هتيجي في خطة 04.

## الأمان
- مفيش سر بيتسجل في اللوج (فيه اختبار بيفحص الكود). الـ outbox والـ audit مفيهمش روابط ولا أكواد ولا نص رسالة، والوجهة مقنّعة.
- Rate limits: لكل IP + معرّف (`RECOVERY_RATE_MAX`)، وحد الساعة لكل حساب `auth.recovery.max_per_hour`.
- Audit: `portal.channel.added/removed`، `portal.recovery.started/verified/completed/owner_requested`، `portal.admin_code.issued`، `portal.activation.completed`.

## الإعداد
### الإيميل (Gmail أو Brevo)
- Gmail: فعّل التحقق بخطوتين ثم اعمل «App Password»، واستخدم `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS` (App Password)، و`EMAIL_FROM`.
- Brevo: `EMAIL_PROVIDER=brevo` و`EMAIL_API_KEY`. لتحسين الوصول لصندوق الوارد على دومين خاص أضف SPF وDKIM من لوحة المزوّد.
- جرّب من الإدارة: `POST /portal-admin/channels/email/test`.
### تيليجرام
1. من BotFather خد الـ token (البوت `@HyperTechPortalBot`).
2. ظبط `TELEGRAM_BOT_TOKEN` و`TELEGRAM_WEBHOOK_SECRET` (نص عشوائي طويل) على Vercel.
3. بعد النشر: `node scripts/telegram-set-webhook.mjs https://<دومينك>`.

## الرجوع (rollback)
الجداول جديدة وإضافية (expand-only). لو رجّعت الكود القديم هتفضل شغالة، والروابط الجديدة بس مش هيفهمها الكود القديم. مفيش حذف لأي حاجة قديمة.

## مؤجّل
Passkeys (مرحلة 3-b)، وتقييد «طريقة استعادة إجبارية» عند الدخول (الإعداد موجود، تطبيقه في واجهة 04).
