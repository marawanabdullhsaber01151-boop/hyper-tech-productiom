<!-- @format -->

# Hyper-Tech ERP — الملفات المضافة في هذه الدفعة

## المرحلة 03 — طوابير المراجعة للموظفين

### ملفات جديدة

```text
public/portal-applications-admin.html
public/JS/portal-applications-admin.js
public/portal-activation-requests-admin.html
public/JS/portal-activation-requests-admin.js
migrations/0034_portal_customer_contact_unique.sql
```

### ملفات معدّلة

```text
src/routes/portal-customers-admin.ts
src/routes/contacts.ts
src/lib/governance.ts
src/lib/departments.ts
src/db/schema/portal-customers.ts
public/CSS/portal-customers-admin.css
DELIVERY_MANIFEST.md
```

### ما تم تنفيذه

- طابور طلبات الانضمام: عرض، قبول داخل transaction، طلب معلومات، ورفض مع
  ملاحظة محفوظة وقابلة للتتبع.
- طابور طلبات التفعيل: عرض الترشيح التلقائي، بحث يدوي في العملاء، تأكيد
  صريح، ورفض مؤرشف.
- إنشاء حسابات البوابة يكتب `portal_activation_tokens` ويجهّز وسيلة التفعيل
  للتسليم في المرحلة التالية، من دون تخزين التوكن الخام.
- منع ربط `contact` بأكثر من حساب بوابة برمجيًا وبدعم unique index في قاعدة
  البيانات.
- إضافة الصفحتين إلى التنقل الديناميكي تحت قسم بوابة العملاء بنفس الأدوار
  الحالية.

هذه الدفعة لا تحتوي على نسخة المشروع كاملة. يتم نسخ الملفات التالية فوق جذر
المشروع الحالي مع الحفاظ على المسارات:

```text
public/operations.html
public/CSS/operations.css
public/JS/operations.js
public/production-requests.html
public/CSS/production-requests.css
public/JS/production-requests.js
public/portal-customers-admin.html
public/CSS/portal-customers-admin.css
public/JS/portal-customers-admin.js
```

## ما تغطيه الدفعة

- شاشة خطط تنفيذ أوامر البيع وطلبات الشراء والاستثناءات والأحداث.
- شاشة إنشاء ومراجعة طلبات الإنتاج.
- شاشة حسابات عملاء البوابة وطلبات إعادة تعيين كلمة المرور.
- RTL وresponsive وescaping لبيانات الجداول.

## طريقة التسليم والتثبيت

1. فك الضغط فوق جذر المشروع الحالي، وليس داخل مجلد فرعي جديد.
2. شغّل `node --check` على ملفات JavaScript الجديدة.
3. شغّل `npm test` و`npm run build`.
4. اختبر الشاشات بقاعدة اختبار حقيقية؛ هذه الدفعة لم تُنفذ على قاعدة بيانات لأن
   `DATABASE_URL` غير موجودة في الملفات المرفقة.

## ملاحظة

الروابط من لوحة التحكم إلى الشاشات الجديدة لم تُعدل في هذه الدفعة، حتى تظل
الدفعة مقتصرة على الملفات المضافة فقط. يمكن فتح الصفحات مباشرة بالمسارات
المذكورة أو إضافة روابط اللوحة في دفعة منفصلة.

---

## المرحلة 04 — تسليم بيانات الدخول ومسار الرفض المزدوج (2026-09-03)

### ملفات جديدة

```text
src/lib/portalMessaging.ts
public/portal-activate.html
public/JS/portal-activate.js
```

### ملفات معدّلة

```text
src/routes/portal-customers-admin.ts
src/routes/portal.ts
public/JS/portal-auth.js
.env.example
DELIVERY_MANIFEST.md
```

### ما تم تنفيذه

- إنشاء طبقة `sendPortalSms()` موحّدة تستخدم `pino` وتسجّل الرسالة كاملة في
  وضع Placeholder؛ لا يوجد إرسال حقيقي لقناة SMS في هذه الدفعة.
- إرسال رسالة القبول بعد نجاح transaction إنشاء الحساب في مساري قبول طلب
  عميل جديد وتأكيد طلب عميل قديم، مع رابط تفعيل صالح 24 ساعة.
- إضافة `POST /portal/activate` وصفحة `portal-activate.html` لتعيين كلمة
  المرور، والتحقق من الانتهاء والاستهلاك لمرة واحدة، وتسجيل العملية في
  `auditEventsTable`.
- إرسال طلب المعلومات الإضافية مع ملاحظة الموظف ورقم الدعم.
- تحديث رفض طلب تفعيل العميل القديم برسالة SMS تحتوي رقم الدعم ورابط تقديم
  طلب عميل جديد، وتحديث شاشة تتبع الطلب لعرض الخيارين.
- توسيع `GET /portal/config` ليعيد `supportPhone`، وإضافة متغيرات البيئة
  الخاصة بالرابط العام ورقم الدعم وإعدادات المزود المستقبلي.
- لم تُضف migration لأن المرحلة لا تغيّر مخطط قاعدة البيانات؛ كل التغييرات
  الجديدة تعتمد على الجداول الموجودة بالفعل.

### ملاحظات التشغيل

- مدة التفعيل الجديدة 24 ساعة، والتوكن الخام لا يظهر في أي JSON API response؛
  يظهر فقط داخل رسالة Placeholder المسجلة في اللوج كما تنص مواصفات المرحلة.
- لا تم تغيير `package.json` أو `package-lock.json`، ولا تمت إضافة حزمة SMS.
- تم تشغيل `npm run build` و`npm test` و`node --check` لملفات JavaScript
  المعدّلة/الجديدة بنجاح.
