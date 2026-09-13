ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS city text;

ALTER TABLE portal_customers
  ADD COLUMN IF NOT EXISTS city text;

ALTER TABLE portal_applications
  ADD COLUMN IF NOT EXISTS city text;

COMMENT ON COLUMN contacts.city IS 'المحافظة المصرية للعنوان التفصيلي';
COMMENT ON COLUMN portal_customers.city IS 'المحافظة المصرية لعنوان عميل البوابة';
COMMENT ON COLUMN portal_applications.city IS 'المحافظة المصرية لطلب الانضمام';