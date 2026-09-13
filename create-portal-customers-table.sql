-- ============================================================
-- سكريبت SQL يدوي — إنشاء/استكمال جداول بوابة العملاء
-- الأفضل في التشغيل المعتاد: npm run db:migrate
-- ============================================================

CREATE TABLE IF NOT EXISTS portal_customers (
  id                      SERIAL PRIMARY KEY,
  phone                   TEXT NOT NULL,
  email                   TEXT,
  password_hash           TEXT NOT NULL,
  full_name               TEXT NOT NULL,
  company_name            TEXT NOT NULL,
  minimum_order_quantity  INTEGER NOT NULL DEFAULT 1,
  contact_id              INTEGER NOT NULL REFERENCES contacts(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE portal_customers
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS minimum_order_quantity INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'portal_customers_phone_unique'
      AND conrelid = 'portal_customers'::regclass
  ) THEN
    ALTER TABLE portal_customers
      ADD CONSTRAINT portal_customers_phone_unique UNIQUE (phone);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'portal_customers_email_unique'
      AND conrelid = 'portal_customers'::regclass
  ) THEN
    ALTER TABLE portal_customers
      ADD CONSTRAINT portal_customers_email_unique UNIQUE (email);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS portal_password_reset_requests (
  id                  SERIAL PRIMARY KEY,
  portal_customer_id  INTEGER NOT NULL REFERENCES portal_customers(id),
  status              TEXT NOT NULL DEFAULT 'pending',
  resolved_by_id      INTEGER,
  resolved_by_name    TEXT,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_order_reviews (
  id                 SERIAL PRIMARY KEY,
  batch_ref          TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'confirmed',
  reply_message      TEXT,
  expected_delivery  DATE,
  reject_reason      TEXT,
  sales_order_id     INTEGER,
  reviewed_by_id     INTEGER NOT NULL,
  reviewed_by_name   TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portal_order_reviews_batch_ref_unique UNIQUE (batch_ref)
);

-- تأكيد نهائي: اعرض البنية بعد الإنشاء/الاستكمال للتأكد.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name IN (
  'portal_customers',
  'portal_password_reset_requests',
  'portal_order_reviews'
)
ORDER BY table_name, ordinal_position;
