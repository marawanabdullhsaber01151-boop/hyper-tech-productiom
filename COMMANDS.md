<!-- @format -->

# خطة 03 — القنوات والتفعيل واستعادة كلمة السر

## 1) انسخ الملفات

فك `Plan03-changed-files.zip` فوق مجلد المشروع (نفس المسارات).

## 2) أوامر التشغيل (على جهازك)

```bash
npm install            # بيركّب nodemailer
npm run db:migrate     # بيطبّق migrations/0072_portal_channels.sql
npm run typecheck:web  # اختياري
npm test
```

## 3) متغيرات البيئة على Vercel (Settings → Environment Variables)

| المتغير                                                                  | ملاحظة                                      |
| ------------------------------------------------------------------------ | ------------------------------------------- |
| `AUTH_CODE_PEPPER`                                                       | نص عشوائي طويل (لو فاضي بيستخدم JWT_SECRET) |
| `EMAIL_FROM` , `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`        | Gmail App Password أو Brevo SMTP            |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | اختياري — لتيليجرام                         |

لو متظبطتش، الإرسال الآلي بيتخطّى بصراحة، ورابط الواتساب اليدوي بيفضل شغال.

## 4) بعد النشر

```bash
# تيليجرام (مرة واحدة)
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-set-webhook.mjs https://<دومينك>
```

ثم Hard refresh (Ctrl+Shift+R).

## 5) جرّب

- من صفحة «عملاء البوابة»: زرار **كود إدارة** لأي حساب مفعّل.
- من صفحة الدخول: «نسيت كلمة المرور؟» ← صفحة الاستعادة الجديدة.
- لما تعتمد طلب جديد: التفعيل بيتبعت على الإيميل لو متظبط، وبيرجعلك رابط واتساب احتياطي دايماً.
