# تقرير الخطة 00 — الإصلاح العاجل لتفعيل حسابات البوابة

## اللي اتعمل
- **رابط التفعيل بقى بيوصل للموظف**: بعد «قبول طلب انضمام» أو «تأكيد طلب تفعيل» الرد فيه `activation { url, expiresAt, whatsappUrl, message, delivered }`. بيتعرض مرة واحدة في نافذة فيها نسخ + «افتح واتساب»، ومن غير أي مزود SMS.
- **`POST /portal-customers/:id/activation-link`**: يولّد رابط جديد (15 دقيقة – 30 يوم، الافتراضي 24 ساعة) ويبطل أي رابط قديم. للحسابات اللي لسه ما اتفعّلتش بس (409 `PORTAL_ACCOUNT_ALREADY_ACTIVATED` للمفعّل). صلاحية `portalCustomers.write`، حد 10/ساعة/موظف (`PORTAL_ACTIVATION_LINK_RATE_MAX`)، وسجل تدقيق `portal.customer.activation_link.issued`.
- **خدمة موحدة** `src/lib/portalActivation.ts` (التوكن، الصلاحية، wa.me، نص الرسالة).
- **`activated_at` و`must_change_password`** (هجرة `0069`) + `activated` في `GET /portal-customers`.
- **إعادة تعيين الباسورد اليدوية**: بتقفل كل جلسات العميل في نفس الـ transaction، وبتفعّل «لازم يغيّر»، والرد فيه `whatsappUrl`. الطلب `POST /portal/orders` بيرد `403 PASSWORD_CHANGE_REQUIRED` لحد ما يغيّر.
- **`POST /portal/change-password`** (الباسورد الحالي + الجديد): بيشيل العلامة وبيقفل باقي الجلسات. وفي البوابة نافذة إجبارية بتظهر للعميل.
- **أدوار إشعار «نسيت الباسورد»** بقت من `PERMISSIONS.portalCustomers.write` (كانت hr/hr_manager).
- **مقارنة التليفون** في الانضمام/طلب التفعيل/الاعتماد بالرقم المُطبَّع.
- **`PORTAL_SMS_FROM`**: `otpDelivery` بيقبل الاسمين (`PORTAL_SMS_PROVIDER_FROM` له الأولوية)، و`.env.example` اتحدّث بالأسماء الصح ومتغيرات الإيميل.
- **الواجهات القديمة**: نافذة مشتركة `public/JS/portal-admin-dialogs.js` (من غير `alert/prompt` لإعادة التعيين)، شارة «لسه ما اتفعّلش» وزر «رابط تفعيل»، ورسائل النجاح بتعتمد على `delivered` الحقيقي.

## القرارات
- الرابط والباسورد المؤقت بيتبنوا في DOM بـ DOM API (مش innerHTML) وبيتشالوا من الصفحة لما النافذة تقفل.
- الرابط الخام مش في اللوج ولا في audit (اتأكد باختبار).
- لو الحساب مفعّل، النظام يرفض إصدار رابط (عشان الرابط ما يبقاش باب استيلاء على حساب شغال)، والطريق هو «تعيين كلمة مرور».

## الملفات
`migrations/0069_portal_activated_at.sql`, `src/db/schema/portal-customers.ts`, `src/lib/portalActivation.ts` (+test), `src/lib/otpDelivery.ts` (+test), `src/routes/portal-customers-admin.ts`, `src/routes/portal.ts`, `.env.example`, `public/JS/portal-admin-dialogs.js`, `public/JS/portal-{applications,activation-requests,customers}-admin.js` + HTMLs + `portal-customers-admin.css`, `public/JS/portal.js` + `portal.css`, `e2e/portal-activation.e2e.test.ts`.

## الاختبارات
- `npm run build` ناجح. `npm test`: 363 ناجح (3 skipped قديمة).
- e2e على PostgreSQL حقيقي (7 اختبارات): قبول بدون SMS، تكرار الرقم بصيغة تانية، إبطال الرابط القديم، الحدود، رفض المفعّل، إلغاء الجلسات وإجبار التغيير، أدوار الإشعار. تشغيله: `E2E_DATABASE_URL=… E2E_ADMIN_PASSWORD=… npx vitest run --config vitest.e2e.config.ts e2e/portal-activation.e2e.test.ts`.
- الهجرة: اتجربت idempotent، والـ backfill اتجرب (حساب بدون توكن/بتوكن مستهلك/بجلسة = مفعّل، بتوكن غير مستخدم فقط = غير مفعّل).
- الواجهة اتجربت في متصفح حقيقي (ديسكتوب + موبايل): النسخ شغال، الرابط بيتمسح، من غير أخطاء console.

## التراجع
الهجرة إضافات فقط (عمودين). للتراجع: ارجع الكود، والعمودين الزايدين ما بيضروش. مفيش حذف بيانات.

## ملاحظات / مش مكتمل
- **سلسلة الهجرات القديمة بتفشل على قاعدة فاضية** عند `0055` (عمود `workflow_order_id` مش موجود) — موجودة قبل شغلي، فمش من النطاق. اتجهزت قاعدة الاختبار بـ `drizzle-kit push` + `0038`. يفضل نراجعها قبل أي نشر على قاعدة جديدة.
- ملفات e2e القديمة بتعمل `import { app }` وهو غير موجود (الـ export default بس) فهي كانت مش بتشتغل؛ ما اتعدلتش.
- أخطاء TypeScript القديمة في `engineering.ts` و`foundation.ts` (9) ما اتلمستش.
- حد 10/ساعة محفوظ في ذاكرة السيرفر؛ على Vercel serverless هو حد تقريبي (يتصفّر مع كل instance). يتحوّل لجدول عند الخطة 02.
- ردّ `/portal/applications` لسه بيفرّق بين 201 و202 (تسريب وجود) — مقصود تأجيله لخطة الانضمام (06).
- ما اتجرّبش إرسال SMS حقيقي (مفيش مزود).
