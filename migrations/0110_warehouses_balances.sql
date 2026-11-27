-- 0110 (المخازن - المرحلة أ): نموذج المخازن والأرصدة لكل مخزن.
--   * warehouses: مخزن له نوع من تلاتة (raw خام / wip تحت تشغيل / finished تام). في مخزن افتراضي واحد لكل نوع.
--   * stock_balances: رصيد (صنف × مخزن) بالكمية والمحجوز والحجر.
--   * inventory_items.qty/reserved_qty/quarantine_qty بقوا "الإجمالي" بيتحسب تلقائيًا من الأرصدة (الكود القديم كله لسه شغال).
--     أي تعديل مباشر قديم على الإجمالي بيتحوّل لفرق على المخزن الافتراضي لفئة الصنف، فمجموع الأرصدة = إجمالي الصنف دايمًا.
--   * قاعدة النوع والصنف في القاعدة نفسها: الخام (خام/تحت تشغيل)، التام (تحت تشغيل/تام)، نص المصنّع (تحت تشغيل).
--   * stock_movements.warehouse_id: كل حركة مربوطة بمخزن (القديم اتعبّى بالمخزن الافتراضي لفئة الصنف).
--   * الهجرة قابلة للتكرار: لا بتضاعف أرصدة ولا بتكرر مخازن.
-- Rollback (بعد ما توقف أي كود جديد):
--   DROP TRIGGER IF EXISTS stock_balances_sync ON stock_balances; DROP TRIGGER IF EXISTS stock_balances_kind_guard ON stock_balances;
--   DROP TRIGGER IF EXISTS inventory_items_stock_guard ON inventory_items; DROP TRIGGER IF EXISTS inventory_items_seed_balance ON inventory_items;
--   DROP TRIGGER IF EXISTS stock_movements_fill_wh ON stock_movements; DROP TRIGGER IF EXISTS warehouses_guard ON warehouses;
--   DROP FUNCTION IF EXISTS wh_sync_totals(); DROP FUNCTION IF EXISTS wh_kind_guard(); DROP FUNCTION IF EXISTS wh_items_stock_guard();
--   DROP FUNCTION IF EXISTS wh_items_seed_balance(); DROP FUNCTION IF EXISTS wh_fill_movement(); DROP FUNCTION IF EXISTS wh_guard(); DROP FUNCTION IF EXISTS wh_kind_ok(text,text); DROP FUNCTION IF EXISTS wh_default_kind(text);
--   ALTER TABLE stock_movements DROP COLUMN IF EXISTS warehouse_id; DROP TABLE IF EXISTS stock_balances; DROP TABLE IF EXISTS warehouses;

CREATE TABLE IF NOT EXISTS "warehouses" (
  "id" serial PRIMARY KEY,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('raw','wip','finished')),
  "location_id" integer REFERENCES "foundation_locations"("id") ON DELETE SET NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "active" boolean NOT NULL DEFAULT true,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_code_unique" ON "warehouses" (lower("code"));
CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_kind_name_unique" ON "warehouses" ("kind", lower("name"));
CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_one_default_per_kind" ON "warehouses" ("kind") WHERE "is_default";

INSERT INTO "warehouses" ("code", "name", "kind", "is_default") VALUES
  ('WH-RAW', 'مخزن الخامات', 'raw', true),
  ('WH-WIP', 'مخزن تحت التشغيل', 'wip', true),
  ('WH-FG',  'مخزن المنتج التام', 'finished', true)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "stock_balances" (
  "id" serial PRIMARY KEY,
  "item_id" integer NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "warehouse_id" integer NOT NULL REFERENCES "warehouses"("id"),
  "qty" numeric(12,3) NOT NULL DEFAULT 0,
  "reserved_qty" numeric(12,3) NOT NULL DEFAULT 0,
  "quarantine_qty" numeric(12,3) NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "stock_balances_item_wh_unique" UNIQUE ("item_id", "warehouse_id")
);
CREATE INDEX IF NOT EXISTS "stock_balances_wh_idx" ON "stock_balances" ("warehouse_id");

CREATE OR REPLACE FUNCTION wh_default_kind(cat text) RETURNS text AS $$
  SELECT CASE cat WHEN 'wip' THEN 'wip' WHEN 'finished_good' THEN 'finished' ELSE 'raw' END
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION wh_kind_ok(cat text, k text) RETURNS boolean AS $$
  SELECT CASE cat
    WHEN 'raw_material' THEN k IN ('raw','wip')
    WHEN 'wip' THEN k = 'wip'
    WHEN 'finished_good' THEN k IN ('wip','finished')
    ELSE k = 'raw' END
$$ LANGUAGE sql IMMUTABLE;

-- نقل الأرصدة الحالية للمخزن الافتراضي لفئة كل صنف (قبل تركيب التريجرات، ومن غير تكرار).
INSERT INTO "stock_balances" ("item_id", "warehouse_id", "qty", "reserved_qty", "quarantine_qty")
SELECT i.id, w.id, i.qty, i.reserved_qty, i.quarantine_qty
FROM "inventory_items" i
JOIN "warehouses" w ON w.is_default AND w.kind = wh_default_kind(i.category)
WHERE i.qty <> 0 OR i.reserved_qty <> 0 OR i.quarantine_qty <> 0
ON CONFLICT ("item_id", "warehouse_id") DO NOTHING;

-- القيود بعد النقل وبـ NOT VALID: القديم (لو فيه رصيد سالب) مايوقفش الهجرة، لكن أي كتابة جديدة بتتفحص.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_balances_qty_nonneg') THEN
    ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_qty_nonneg" CHECK ("qty" >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_balances_reserved_nonneg') THEN
    ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_reserved_nonneg" CHECK ("reserved_qty" >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_balances_quarantine_nonneg') THEN
    ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_quarantine_nonneg" CHECK ("quarantine_qty" >= 0) NOT VALID;
  END IF;
END $$;

-- الحركات: ربط كل حركة بمخزن.
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "warehouse_id" integer REFERENCES "warehouses"("id");
UPDATE "stock_movements" m SET "warehouse_id" = w.id
FROM "inventory_items" i, "warehouses" w
WHERE m."warehouse_id" IS NULL AND i.id = m."inventory_item_id" AND w.is_default AND w.kind = wh_default_kind(i.category);
ALTER TABLE "stock_movements" ALTER COLUMN "warehouse_id" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "stock_movements_warehouse_idx" ON "stock_movements" ("warehouse_id", "created_at");

-- 1) المخزن لازم يناسب فئة الصنف، ومايتكتبش رصيد جديد في مخزن موقوف.
CREATE OR REPLACE FUNCTION wh_kind_guard() RETURNS trigger AS $$
DECLARE cat text; k text; act boolean;
BEGIN
  SELECT category INTO cat FROM inventory_items WHERE id = NEW.item_id;
  SELECT kind, active INTO k, act FROM warehouses WHERE id = NEW.warehouse_id;
  IF NOT wh_kind_ok(cat, k) THEN RAISE EXCEPTION 'WH_KIND_MISMATCH'; END IF;
  IF NOT act THEN
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'WH_INACTIVE'; END IF;
    IF NEW.qty > OLD.qty THEN RAISE EXCEPTION 'WH_INACTIVE'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS stock_balances_kind_guard ON "stock_balances";
CREATE TRIGGER stock_balances_kind_guard BEFORE INSERT OR UPDATE ON "stock_balances" FOR EACH ROW EXECUTE FUNCTION wh_kind_guard();

-- 2) إجمالي الصنف = مجموع أرصدته. العلم hyper.stock_sync بيمنع الدوران (التريجر ده والتريجر 3 بيكلّموا بعض).
CREATE OR REPLACE FUNCTION wh_sync_totals() RETURNS trigger AS $$
DECLARE iid integer; prev text;
BEGIN
  IF current_setting('hyper.stock_sync', true) = 'on' THEN RETURN NULL; END IF;
  iid := CASE WHEN TG_OP = 'DELETE' THEN OLD.item_id ELSE NEW.item_id END;
  prev := COALESCE(current_setting('hyper.stock_sync', true), '');
  PERFORM set_config('hyper.stock_sync', 'on', true);
  UPDATE inventory_items i SET
    qty = COALESCE(s.q, 0), reserved_qty = COALESCE(s.r, 0), quarantine_qty = COALESCE(s.k, 0), updated_at = now()
  FROM (SELECT iid AS id) x
  LEFT JOIN (SELECT sum(qty) q, sum(reserved_qty) r, sum(quarantine_qty) k FROM stock_balances WHERE item_id = iid) s ON true
  WHERE i.id = x.id;
  PERFORM set_config('hyper.stock_sync', prev, true);
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS stock_balances_sync ON "stock_balances";
CREATE TRIGGER stock_balances_sync AFTER INSERT OR UPDATE OR DELETE ON "stock_balances" FOR EACH ROW EXECUTE FUNCTION wh_sync_totals();

-- 3) تعديل مباشر قديم على الإجمالي = فرق على المخزن الافتراضي لفئة الصنف. وتغيير الفئة بيتمنع لو الرصيد في مخزن مايناسبش الفئة الجديدة.
CREATE OR REPLACE FUNCTION wh_items_stock_guard() RETURNS trigger AS $$
DECLARE wid integer; prev text; dq numeric; dr numeric; dk numeric; sq numeric; sr numeric; sk numeric;
BEGIN
  IF current_setting('hyper.stock_sync', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.category IS DISTINCT FROM OLD.category AND EXISTS (
    SELECT 1 FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id
    WHERE b.item_id = OLD.id AND (b.qty <> 0 OR b.reserved_qty <> 0 OR b.quarantine_qty <> 0) AND NOT wh_kind_ok(NEW.category, w.kind)
  ) THEN RAISE EXCEPTION 'WH_KIND_MISMATCH'; END IF;
  dq := NEW.qty - OLD.qty; dr := NEW.reserved_qty - OLD.reserved_qty; dk := NEW.quarantine_qty - OLD.quarantine_qty;
  IF dq = 0 AND dr = 0 AND dk = 0 THEN RETURN NEW; END IF;
  SELECT id INTO wid FROM warehouses WHERE is_default AND kind = wh_default_kind(NEW.category);
  IF wid IS NULL THEN RAISE EXCEPTION 'WH_NO_DEFAULT'; END IF;
  prev := COALESCE(current_setting('hyper.stock_sync', true), '');
  PERFORM set_config('hyper.stock_sync', 'on', true);
  INSERT INTO stock_balances (item_id, warehouse_id, qty, reserved_qty, quarantine_qty) VALUES (OLD.id, wid, 0, 0, 0)
    ON CONFLICT (item_id, warehouse_id) DO NOTHING;
  UPDATE stock_balances SET qty = qty + dq, reserved_qty = reserved_qty + dr, quarantine_qty = quarantine_qty + dk, updated_at = now()
    WHERE item_id = OLD.id AND warehouse_id = wid;
  SELECT COALESCE(sum(qty), 0), COALESCE(sum(reserved_qty), 0), COALESCE(sum(quarantine_qty), 0) INTO sq, sr, sk FROM stock_balances WHERE item_id = OLD.id;
  PERFORM set_config('hyper.stock_sync', prev, true);
  NEW.qty := sq; NEW.reserved_qty := sr; NEW.quarantine_qty := sk;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS inventory_items_stock_guard ON "inventory_items";
CREATE TRIGGER inventory_items_stock_guard BEFORE UPDATE ON "inventory_items" FOR EACH ROW EXECUTE FUNCTION wh_items_stock_guard();

-- 4) صنف جديد (أو راجع من السلة/النسخة الاحتياطية) برصيد: الرصيد بيتحط في المخزن الافتراضي لفئته.
CREATE OR REPLACE FUNCTION wh_items_seed_balance() RETURNS trigger AS $$
DECLARE wid integer; prev text;
BEGIN
  IF current_setting('hyper.stock_sync', true) = 'on' THEN RETURN NULL; END IF;
  IF NEW.qty = 0 AND NEW.reserved_qty = 0 AND NEW.quarantine_qty = 0 THEN RETURN NULL; END IF;
  SELECT id INTO wid FROM warehouses WHERE is_default AND kind = wh_default_kind(NEW.category);
  IF wid IS NULL THEN RAISE EXCEPTION 'WH_NO_DEFAULT'; END IF;
  prev := COALESCE(current_setting('hyper.stock_sync', true), '');
  PERFORM set_config('hyper.stock_sync', 'on', true);
  INSERT INTO stock_balances (item_id, warehouse_id, qty, reserved_qty, quarantine_qty) VALUES (NEW.id, wid, NEW.qty, NEW.reserved_qty, NEW.quarantine_qty)
    ON CONFLICT (item_id, warehouse_id) DO NOTHING;
  PERFORM set_config('hyper.stock_sync', prev, true);
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS inventory_items_seed_balance ON "inventory_items";
CREATE TRIGGER inventory_items_seed_balance AFTER INSERT ON "inventory_items" FOR EACH ROW EXECUTE FUNCTION wh_items_seed_balance();

-- 5) حركة من غير مخزن (كود قديم/نسخة احتياطية قديمة) بتاخد المخزن الافتراضي لفئة الصنف.
CREATE OR REPLACE FUNCTION wh_fill_movement() RETURNS trigger AS $$
BEGIN
  IF NEW.warehouse_id IS NULL THEN
    SELECT w.id INTO NEW.warehouse_id FROM warehouses w, inventory_items i
      WHERE i.id = NEW.inventory_item_id AND w.is_default AND w.kind = wh_default_kind(i.category);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS stock_movements_fill_wh ON "stock_movements";
CREATE TRIGGER stock_movements_fill_wh BEFORE INSERT ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION wh_fill_movement();

-- 6) حماية المخازن نفسها: النوع ثابت، المخزن الافتراضي مايتوقفش ولا يتمسح، المخزن اللي عليه رصيد مايتوقفش، واللي اتستخدم مايتمسحش (بيتأرشف).
CREATE OR REPLACE FUNCTION wh_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_default THEN RAISE EXCEPTION 'WH_DEFAULT_LOCKED'; END IF;
    IF EXISTS (SELECT 1 FROM stock_balances WHERE warehouse_id = OLD.id) OR EXISTS (SELECT 1 FROM stock_movements WHERE warehouse_id = OLD.id) THEN RAISE EXCEPTION 'WH_IN_USE'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN RAISE EXCEPTION 'WH_KIND_LOCKED'; END IF;
  IF OLD.is_default AND (NOT NEW.is_default OR NOT NEW.active) THEN RAISE EXCEPTION 'WH_DEFAULT_LOCKED'; END IF;
  IF OLD.active AND NOT NEW.active AND EXISTS (
    SELECT 1 FROM stock_balances WHERE warehouse_id = OLD.id AND (qty <> 0 OR reserved_qty <> 0 OR quarantine_qty <> 0)
  ) THEN RAISE EXCEPTION 'WH_HAS_STOCK'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS warehouses_guard ON "warehouses";
CREATE TRIGGER warehouses_guard BEFORE UPDATE OR DELETE ON "warehouses" FOR EACH ROW EXECUTE FUNCTION wh_guard();
