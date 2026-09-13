-- Hyper-Tech ERP: persist the wholesale portal cart and wishlist per customer.
-- Additive and safe to run repeatedly.

CREATE TABLE IF NOT EXISTS portal_cart_items (
  id serial PRIMARY KEY,
  portal_customer_id integer NOT NULL,
  bom_recipe_id integer NOT NULL,
  qty numeric(12, 3) NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'portal_cart_items_portal_customer_id_fk'
      AND conrelid = 'portal_cart_items'::regclass
  ) THEN
    ALTER TABLE portal_cart_items
      ADD CONSTRAINT portal_cart_items_portal_customer_id_fk
      FOREIGN KEY (portal_customer_id) REFERENCES portal_customers(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'portal_cart_items_bom_recipe_id_fk'
      AND conrelid = 'portal_cart_items'::regclass
  ) THEN
    ALTER TABLE portal_cart_items
      ADD CONSTRAINT portal_cart_items_bom_recipe_id_fk
      FOREIGN KEY (bom_recipe_id) REFERENCES bom_recipes(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS portal_cart_items_customer_recipe_unique
  ON portal_cart_items (portal_customer_id, bom_recipe_id);
CREATE INDEX IF NOT EXISTS portal_cart_items_customer_idx
  ON portal_cart_items (portal_customer_id);

CREATE TABLE IF NOT EXISTS portal_wishlist_items (
  id serial PRIMARY KEY,
  portal_customer_id integer NOT NULL,
  bom_recipe_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'portal_wishlist_items_portal_customer_id_fk'
      AND conrelid = 'portal_wishlist_items'::regclass
  ) THEN
    ALTER TABLE portal_wishlist_items
      ADD CONSTRAINT portal_wishlist_items_portal_customer_id_fk
      FOREIGN KEY (portal_customer_id) REFERENCES portal_customers(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'portal_wishlist_items_bom_recipe_id_fk'
      AND conrelid = 'portal_wishlist_items'::regclass
  ) THEN
    ALTER TABLE portal_wishlist_items
      ADD CONSTRAINT portal_wishlist_items_bom_recipe_id_fk
      FOREIGN KEY (bom_recipe_id) REFERENCES bom_recipes(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS portal_wishlist_items_customer_recipe_unique
  ON portal_wishlist_items (portal_customer_id, bom_recipe_id);
CREATE INDEX IF NOT EXISTS portal_wishlist_items_customer_idx
  ON portal_wishlist_items (portal_customer_id);