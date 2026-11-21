-- 0104 — سياسة اعتماد تجاوز حد الائتمان (الخطوة 52)
--
-- أمر بيع بيتجاوز حد ائتمان العميل (والسياسة «منع») بيتحوّل لطلب اعتماد بمفتاح sales.credit_override.
-- المعتمد: المدير التنفيذي أو رئيس المجلس بس (أقوى من اعتماد مدير المبيعات العادي)، وبيعدّي على نفس صندوق الاعتمادات.
-- مفيش جداول جديدة: حد الائتمان هو العمود contacts.credit_limit الموجود (فاضي = مفيش حد).
--
-- Rollback:
--   DELETE FROM approval_policies WHERE action_key = 'sales.credit_override';

INSERT INTO "approval_policies" ("action_key", "min_amount", "approver_roles", "sequence", "required_approvals", "active")
SELECT 'sales.credit_override', 0::numeric, '["executive_manager","chairman"]'::jsonb, 1, 1, true
WHERE NOT EXISTS (SELECT 1 FROM "approval_policies" WHERE "action_key" = 'sales.credit_override');
