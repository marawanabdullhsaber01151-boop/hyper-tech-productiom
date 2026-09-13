# تقرير المرحلة 02 — بداية توحيد API Contracts

## الحالة

مكتملة كطبقة نقل متوافقة. لا تحتاج الصفحات القديمة إلى إعادة كتابة فورية:
كل استجابة JSON من API تمر عبر envelope موحّد، بينما تظل payloads الناجحة
القديمة داخل `data`.

## ما تم تنفيذه

- إضافة عقد نجاح موحد `ApiSuccess<T>`.
- إضافة عقد خطأ موحد مع code/message/details/reference.
- إضافة `HttpError` وقراءة أخطاء HTTP typed.
- إضافة pagination schema وmetadata bounded.
- تحديث error handler لاستخدام نفس envelope في أخطاء 404 و500 وأخطاء domain.
- الحفاظ على successful legacy payloads لتجنب كسر الشاشات أثناء الترحيل التدريجي.
- توحيد ردود auth وsession وإرجاع codes ثابتة في كل حالات 401 و403 و404 و400.
- جعل `HyperTechAuth.request` نقطة الاتصال الوحيدة للواجهة، مع تمييز network
  failure عن HTTP failure وعن انتهاء الجلسة.
- إضافة اختبارات للـ envelope ومعالج الأخطاء.
- توثيق قواعد status codes والتوافق في `docs/api-contracts.md`.

## الفحوصات

- `npm test`: ناجح.
- `npm run build`: ناجح.
- الاستجابات القديمة ما زالت source-compatible بعد فك `data` في العميل.
- أخطاء HTML/network لا تُحوّل إلى `SyntaxError` غامض.

## حدود معلومة

الـ successful payloads لم تُعد كتابتها يدويًا داخل كل route؛
`apiEnvelope` هو compatibility boundary مركزي يغطيها كلها.

## نقطة الاستكمال

- آخر شيء تم إنجازه: إغلاق طبقة النقل الموحدة وتوحيد auth responses وطبقة العميل.
- المهمة التالية: لا توجد مهمة متبقية في المرحلة 02؛ الانتقال إلى المرحلة 04 بعد
  إغلاق التحقق التشغيلي للمرحلة 03.
- التحقق: `pnpm --filter @workspace/api-server run test` و`pnpm --filter @workspace/api-server run build`.
- المؤجل: تحويل كل routes القديمة إلى envelope واحد بعد تحديث callers.