-- 0108 (الخطوة 54): التكلفة المعيارية والانحرافات وربحية كل دفعة.
--   recipe_standard_costs        : المعيار لكل وصفة (عمالة/ماكينات/طاقة/مصاريف لدفعة بحجم output_qty + نسبة الإنتاج السليم المتوقعة).
--   recipe_standard_history      : كل تغيير في المعيار بسبب ومين غيّره (للإضافة بس).
--   batch_cost_sheets            : كشف تكلفة الدفعة (معياري/فعلي/انحرافات/ربحية). مسودة قابلة لإعادة الحساب، وبعد الاعتماد «نهائي» مبيتعدّلش.
-- الخامات المعيارية بتتحسب من مكونات الوصفة وقت الحساب وبتتجمّد في الكشف.
-- Rollback:
--   DROP TABLE IF EXISTS batch_cost_sheets; DROP TABLE IF EXISTS recipe_standard_history; DROP TABLE IF EXISTS recipe_standard_costs;

CREATE TABLE IF NOT EXISTS "recipe_standard_costs" (
  "recipe_id" integer PRIMARY KEY REFERENCES "bom_recipes"("id") ON DELETE CASCADE,
  "labor" numeric(14,2) NOT NULL DEFAULT 0 CHECK ("labor" >= 0),
  "machine" numeric(14,2) NOT NULL DEFAULT 0 CHECK ("machine" >= 0),
  "energy" numeric(14,2) NOT NULL DEFAULT 0 CHECK ("energy" >= 0),
  "overhead" numeric(14,2) NOT NULL DEFAULT 0 CHECK ("overhead" >= 0),
  "yield_percent" numeric(5,2) NOT NULL DEFAULT 100 CHECK ("yield_percent" > 0 AND "yield_percent" <= 100),
  "version" integer NOT NULL DEFAULT 1 CHECK ("version" >= 1),
  "updated_by" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "updated_by_name" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "recipe_standard_history" (
  "id" serial PRIMARY KEY,
  "recipe_id" integer NOT NULL REFERENCES "bom_recipes"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "labor" numeric(14,2) NOT NULL,
  "machine" numeric(14,2) NOT NULL,
  "energy" numeric(14,2) NOT NULL,
  "overhead" numeric(14,2) NOT NULL,
  "yield_percent" numeric(5,2) NOT NULL,
  "reason" text NOT NULL CHECK (char_length(btrim("reason")) >= 3),
  "changed_by" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "changed_by_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("recipe_id", "version")
);

CREATE OR REPLACE FUNCTION recipe_standard_history_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'STANDARD_HISTORY_IMMUTABLE'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS recipe_standard_history_guard ON "recipe_standard_history";
CREATE TRIGGER recipe_standard_history_guard BEFORE UPDATE OR DELETE ON "recipe_standard_history" FOR EACH ROW EXECUTE FUNCTION recipe_standard_history_immutable();

CREATE TABLE IF NOT EXISTS "batch_cost_sheets" (
  "id" serial PRIMARY KEY,
  "batch_id" integer NOT NULL UNIQUE REFERENCES "production_batches"("id"),
  "order_id" integer NOT NULL REFERENCES "production_workflow_orders"("id"),
  "recipe_id" integer REFERENCES "bom_recipes"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft','final')),
  "standard_version" integer,
  "produced_qty" numeric(14,3) NOT NULL,
  "accepted_qty" numeric(14,3) NOT NULL,
  "scrap_qty" numeric(14,3) NOT NULL,
  "rework_qty" numeric(14,3) NOT NULL,
  "std_material" numeric(14,2) NOT NULL,
  "std_labor" numeric(14,2) NOT NULL,
  "std_machine" numeric(14,2) NOT NULL,
  "std_energy" numeric(14,2) NOT NULL,
  "std_overhead" numeric(14,2) NOT NULL,
  "act_material" numeric(14,2) NOT NULL,
  "act_labor" numeric(14,2) NOT NULL,
  "act_machine" numeric(14,2) NOT NULL,
  "act_energy" numeric(14,2) NOT NULL,
  "act_overhead" numeric(14,2) NOT NULL,
  "act_waste" numeric(14,2) NOT NULL,
  "std_total" numeric(14,2) NOT NULL,
  "act_total" numeric(14,2) NOT NULL,
  "variance_total" numeric(14,2) NOT NULL,
  "efficiency_loss" numeric(14,2) NOT NULL,
  "unit_price" numeric(12,2),
  "price_source" text,
  "revenue" numeric(14,2),
  "profit" numeric(14,2),
  "computed_by" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "computed_by_name" text NOT NULL,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  "finalized_by_name" text,
  "finalized_at" timestamptz,
  CHECK ("status" = 'draft' OR ("finalized_at" IS NOT NULL AND "finalized_by_name" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "batch_cost_sheets_order_idx" ON "batch_cost_sheets" ("order_id");

-- الكشف النهائي مبيتعدّلش ولا بيتمسح. والاعتماد بيحصل على دفعة مقفولة بس.
CREATE OR REPLACE FUNCTION batch_cost_sheets_guard() RETURNS trigger AS $$
DECLARE b_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'final' THEN RAISE EXCEPTION 'BATCH_SHEET_FINAL'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'final' THEN RAISE EXCEPTION 'BATCH_SHEET_FINAL'; END IF;
  END IF;
  IF NEW.status = 'final' THEN
    SELECT status INTO b_status FROM production_batches WHERE id = NEW.batch_id;
    IF b_status IS DISTINCT FROM 'completed' THEN RAISE EXCEPTION 'BATCH_NOT_COMPLETED'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS batch_cost_sheets_guard_trg ON "batch_cost_sheets";
CREATE TRIGGER batch_cost_sheets_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON "batch_cost_sheets" FOR EACH ROW EXECUTE FUNCTION batch_cost_sheets_guard();
