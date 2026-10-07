# أوامر التشغيل بعد نسخ الملفات (الخطة 00)

انسخ الملفات فوق المشروع بنفس المسارات (الملفات الجديدة تتضاف، والمعدّلة تتبدّل)، وبعدين من فولدر المشروع:

```bash
# 1) تطبيق الهجرة الجديدة 0069 (عمودين: activated_at و must_change_password)
npm run db:migrate

# 2) بناء المشروع + الاختبارات
npm run build
npm test

# 3) تشغيل محلي للتجربة
npm run dev
```

## متغيرات البيئة (اختيارية، في .env)
```
PORTAL_PUBLIC_URL=https://دومينك.vercel.app      # مطلوب في الإنتاج: أصل رابط التفعيل
PORTAL_SUPPORT_PHONE=01055651409                  # بيظهر في رسالة التفعيل
PORTAL_ACTIVATION_LINK_RATE_MAX=10                # حد توليد الروابط/ساعة/موظف
# SMS اختياري (النظام شغال من غيره):
PORTAL_SMS_PROVIDER_API_KEY=
PORTAL_SMS_PROVIDER_URL=
PORTAL_SMS_PROVIDER_FROM=
```

## اختبار e2e على قاعدة حقيقية (اختياري)
```bash
E2E_DATABASE_URL="postgresql://user:pass@localhost:5432/dbname" \
E2E_ADMIN_USERNAME=admin E2E_ADMIN_PASSWORD='كلمة_مرور_الأدمن' \
npx vitest run --config vitest.e2e.config.ts e2e/portal-activation.e2e.test.ts
```

## لو الهجرة محتاج تتنفذ يدوي على Neon (SQL مباشر)
نفّذ محتوى `migrations/0069_portal_activated_at.sql` (آمن للتكرار).

## التراجع
ارجع الملفات القديمة. العمودين الجداد ما بيضروش لو سبتهم.
