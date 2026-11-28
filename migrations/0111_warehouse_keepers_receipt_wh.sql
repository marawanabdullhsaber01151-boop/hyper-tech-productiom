-- 0111 (المخازن - المرحلة ب):
--   * warehouse_keepers: أمناء المخزن لكل مخزن (أمين المخزن اللي عنده تعيين بيشوف ويتحرك في مخازنه بس).
--   * purchase_receipts.warehouse_id: المخزن (من نوع خام) اللي استُلمت فيه البضاعة. القديم فاضي = المخزن الافتراضي للخام.
-- Rollback: ALTER TABLE purchase_receipts DROP COLUMN IF EXISTS warehouse_id; DROP TABLE IF EXISTS warehouse_keepers;

CREATE TABLE IF NOT EXISTS "warehouse_keepers" (
  "id" serial PRIMARY KEY,
  "warehouse_id" integer NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "system_users"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "warehouse_keepers_unique" UNIQUE ("warehouse_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "warehouse_keepers_user_idx" ON "warehouse_keepers" ("user_id");

ALTER TABLE "purchase_receipts" ADD COLUMN IF NOT EXISTS "warehouse_id" integer REFERENCES "warehouses"("id");
