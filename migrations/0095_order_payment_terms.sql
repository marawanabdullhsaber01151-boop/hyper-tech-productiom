-- 0095 — شروط الدفع على أمر الإنتاج (لقطة وقت الطلب) — الخطوة 42ج
--
-- القيمة من إعداد orders.payment_terms (عام أو للشركة) وقت الطلب: cash | credit_15 | credit_30 | credit_60.
-- NULL = أمر قديم أو داخلي قبل الميزة، وبيتعامل كنقدي في العرض.
--
-- Rollback:
--   ALTER TABLE production_workflow_orders DROP COLUMN IF EXISTS payment_terms;

ALTER TABLE "production_workflow_orders" ADD COLUMN IF NOT EXISTS "payment_terms" text;
