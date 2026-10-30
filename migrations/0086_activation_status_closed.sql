-- 0086 — حالة «مقفول» (closed) لطلبات التفعيل
--
-- المشكلة: قيد portal_activation_requests_status_check (من الهجرة 0031) بيسمح بـ pending/confirmed/rejected فقط،
-- بينما زر «قفل الطلب بسبب» (POST /portal-admin/activation-requests/:id/close، الخطة 07) بيكتب status = 'closed'.
-- النتيجة: كل قفل كان بيرجع 500 (انتهاك القيد). اكتشفه اختبار e2e على قاعدة بُنيت من الصفر.
-- الحل: القيد يقبل closed كمان. بيانات الصفوف الموجودة ما بتتغيّر (كلها داخل القيم القديمة).
--
-- Rollback (بعد التأكد إن مفيش صفوف closed، وإلا هيفشل):
--   ALTER TABLE portal_activation_requests DROP CONSTRAINT portal_activation_requests_status_check;
--   ALTER TABLE portal_activation_requests ADD CONSTRAINT portal_activation_requests_status_check
--     CHECK (status IN ('pending', 'confirmed', 'rejected'));

ALTER TABLE portal_activation_requests
  DROP CONSTRAINT IF EXISTS portal_activation_requests_status_check;

ALTER TABLE portal_activation_requests
  ADD CONSTRAINT portal_activation_requests_status_check
  CHECK (status IN ('pending', 'confirmed', 'rejected', 'closed'));
