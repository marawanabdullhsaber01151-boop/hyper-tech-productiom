-- 0098 — عروض الأسعار (الخطوة 45أ)
--
-- عرض سعر مكتوب لعميل (شركة) بمدة صلاحية: سطور (منتج + كمية + سعر الوحدة). لما العميل يطلب منه،
-- الطلب بيتولّد بنفس السعر المتفق عليه (agreed_unit_price على سطر الإنتاج) ومش بيتغيّر وقت المراجعة.
-- «منتهي» بيتحسب وقت القراءة من valid_until (من غير cron)، فمفيش حالة بتتخزّن غلط.
--
-- Rollback:
--   ALTER TABLE production_workflow_orders DROP COLUMN IF EXISTS agreed_unit_price, DROP COLUMN IF EXISTS quote_id;
--   DROP TABLE IF EXISTS price_quote_lines;
--   DROP TABLE IF EXISTS price_quotes;

CREATE TABLE IF NOT EXISTS "price_quotes" (
  "id" serial PRIMARY KEY,
  "quote_number" text NOT NULL UNIQUE,
  "portal_customer_id" integer NOT NULL REFERENCES "portal_customers"("id") ON DELETE CASCADE,
  "customer_name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "valid_until" date NOT NULL,
  "notes" text,
  "created_by" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "created_by_name" text,
  "sent_at" timestamptz,
  "decided_at" timestamptz,
  "decided_by_name" text,
  "decline_reason" text,
  "cancel_reason" text,
  "batch_ref" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "price_quotes_customer_idx" ON "price_quotes" ("portal_customer_id", "id");
CREATE INDEX IF NOT EXISTS "price_quotes_status_idx" ON "price_quotes" ("status", "valid_until");

CREATE TABLE IF NOT EXISTS "price_quote_lines" (
  "id" serial PRIMARY KEY,
  "quote_id" integer NOT NULL REFERENCES "price_quotes"("id") ON DELETE CASCADE,
  "bom_recipe_id" integer NOT NULL REFERENCES "bom_recipes"("id"),
  "product_name" text NOT NULL,
  "qty" numeric(12,3) NOT NULL,
  "unit_price" numeric(12,2) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "price_quote_lines_quote_recipe_unique" ON "price_quote_lines" ("quote_id", "bom_recipe_id");

ALTER TABLE "production_workflow_orders"
  ADD COLUMN IF NOT EXISTS "quote_id" integer REFERENCES "price_quotes"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "agreed_unit_price" numeric(12,2);
