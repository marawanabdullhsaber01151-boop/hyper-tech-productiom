ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS created_by_id integer REFERENCES system_users(id);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'direct';
CREATE INDEX IF NOT EXISTS sales_orders_created_by_idx ON sales_orders(created_by_id);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_user_id integer REFERENCES system_users(id);
CREATE INDEX IF NOT EXISTS contacts_owner_user_idx ON contacts(owner_user_id);