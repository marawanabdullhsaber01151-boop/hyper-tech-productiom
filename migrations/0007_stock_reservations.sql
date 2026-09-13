-- Keep physical stock separate from stock reserved for confirmed sales orders.
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS reserved_qty numeric(12,3) NOT NULL DEFAULT 0;
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_reserved_qty_nonnegative CHECK (reserved_qty >= 0);