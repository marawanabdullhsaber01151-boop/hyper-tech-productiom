# تقرير المرحلة 03 — Foundation وMaster Data

## القرار

تم بدء تنفيذ المرحلة على أساس أن `foundation_items` هو تعريف الصنف الأساسي، بينما
تبقى أرصدة المخزون في جداول التشغيل. لم يتم تغيير schema أو ترحيل بيانات بدون
قاعدة بيانات متصلة.

## ما تم تنفيذه

- إضافة شاشة `public/foundation.html` بصلاحيات الأدوار الإدارية والتشغيلية.
- إضافة `public/JS/foundation.js` لربط الملخص وجميع قوائم Foundation الأساسية.
- إضافة إنشاء وتعديل السجلات عبر نفس API الموجود في الباك إند.
- إضافة بحث للأصناف، حالات تحميل/فراغ/خطأ، ورسائل نجاح.
- إضافة إدارة عدادات المستندات (`/foundation/number-sequences`) من نفس الشاشة.
- إضافة اختيار صنف وإدارة تحويلات وحداته عبر
  `/foundation/items/:id/conversions`.
- إضافة أداة تحقق مباشرة من قواعد انتقال الحالات عبر
  `/foundation/validate-transition`.
- إضافة migration `0021_foundation_inventory_link.sql` لربط الرصيد التشغيلي
  بالتعريف الأساسي مع backfill محافظ يعتمد على تطابق الكود فقط.
- إضافة `manual-migrate-foundation.js` وscript باسم
  `db:migrate:foundation` لأن migrations الإضافية الحالية محفوظة خارج مجلد
  Drizzle baseline ولا تُنفذ تلقائيًا عبر `drizzle-kit migrate`.
- إضافة حماية من XSS في عرض بيانات الخادم باستخدام `escHtml`.
- إضافة تصميم RTL responsive في `public/CSS/foundation.css`.
- إضافة رابط البيانات الأساسية إلى لوحة التحكم.
- الاحتفاظ بسجل التدقيق الموجود في API لكل mutation.

## الـ routes المربوطة

`/foundation/summary`, `/foundation/items`, `/foundation/locations`,
`/foundation/work-centers`, `/foundation/machines`, `/foundation/shifts`,
`/foundation/transitions`, `/foundation/audit`.

## ما تم إصلاحه في مراجعة الإغلاق

- البحث أصبح يشمل اسم الصنف والكود، وليس الاسم فقط.
- إصلاح عدم تطابق حقل الموقع في الواجهة (`locationType` بدل `type`).
- عرض سجل التدقيق باستخدام الحقول الفعلية `actorId` و`actorRole`.
- منع معامل تحويل يساوي صفرًا أو تحويل الوحدة إلى نفسها.
- التحقق من نطاق أوقات الورديات.
- منع تكوين دورة في شجرة المواقع عند تعديل `parentId`.
- إضافة اختبارات validation مستقلة للـ Foundation.

## حدود الإغلاق

- لا يمكن اختبار migration على قاعدة بيانات فارغة أو قاعدة بها بيانات من هذه
  الحزمة لعدم وجود `DATABASE_URL`.
- لذلك المرحلة مكتملة برمجيًا، لكن اعتماد الترحيل التشغيلي يتطلب backup ثم تشغيل
  `npm run db:migrate:foundation` وفحص الصفوف غير المرتبطة.

## الفحص

- TypeScript/build: يتم تشغيله بعد تثبيت dependencies.
- JavaScript: تمت مراجعة الاستخدامات الأساسية للـ API، وتم منع إدخال HTML
  غير موثوق في الجدول والنموذج.
- Responsive/RTL: تمت إضافة breakpoint للهاتف وoverflow آمن للجدول.

## نقطة الاستكمال

- آخر شيء تم إنجازه: إغلاق شاشة Foundation والتحقق والـ migration code review.
- آخر ملف تم تعديله: `public/JS/foundation.js` و`src/routes/foundation.ts`.
- المهمة التالية بالترتيب: backup ثم migration/data audit على قاعدة فعلية، ثم
  الانتقال إلى Governance.
- الأوامر المطلوبة للتحقق: `npm ci`, `npm test`, `npm run build`.
- البيانات أو الحسابات المطلوبة: عدد الأصناف والمواقع والمراكز والماكينات
  النشطة، وسلامة foreign keys عند توفر قاعدة البيانات.
- المشاكل التي لا يجب إعادة تشخيصها من البداية: مصدر API Foundation موجود،
  audit يتم تسجيله من route، وواجهة الاتصال تفك envelope الجديد تلقائيًا.
- القرار المطلوب من صاحب المشروع: لا يوجد قرار مطلوب قبل تنفيذ migration؛
  الترحيل سيُنفذ بعد فحص البيانات وليس على التخمين.