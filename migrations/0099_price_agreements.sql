-- 0099 — اتفاقيات الأسعار (الخطوة 45ب)
--
-- سعر متفق عليه لمنتج لعميل لفترة (من تاريخ لتاريخ) من غير كمية ثابتة. أي طلب عادي من العميل
-- للمنتج ده جوه الفترة بياخد السعر تلقائيًا ومتقفل وقت المراجعة (نفس قفل عروض الأسعار).
-- ممنوع فترتين شغالين متداخلين لنفس العميل والمنتج (بيتفحص في المعاملة).
--
-- Rollback:
--   ALTER TABLE production_workflow_orders DROP COLUMN IF EXISTS agreement_id;
--   DROP TABLE IF EXISTS price_agreements;

CREATE TABLE IF NOT EXISTS "price_agreements" (
  "id" serial PRIMARY KEY,
  "portal_customer_id" integer NOT NULL REFERENCES "portal_customers"("id") ON DELETE CASCADE,
  "customer_name" text NOT NULL,
  "bom_recipe_id" integer NOT NULL REFERENCES "bom_recipes"("id"),
  "product_name" text NOT NULL,
  "unit_price" numeric(12,2) NOT NULL,
  "valid_from" date NOT NULL,
  "valid_until" date NOT NULL,
  "note" text,
  "status" text NOT NULL DEFAULT 'active',
  "created_by" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "created_by_name" text,
  "ended_at" timestamptz,
  "ended_by_name" text,
  "end_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "price_agreements_customer_idx" ON "price_agreements" ("portal_customer_id", "bom_recipe_id", "status");

ALTER TABLE "production_workflow_orders"
  ADD COLUMN IF NOT EXISTS "agreement_id" integer REFERENCES "price_agreements"("id") ON DELETE SET NULL;
