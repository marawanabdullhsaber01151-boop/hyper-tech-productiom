-- Hyper-Tech ERP: additive identity normalization for the portal.
-- The original values remain untouched. Conflicts are reported by row id and
-- intentionally prevent the normalized unique indexes from being created.

CREATE OR REPLACE FUNCTION portal_normalize_phone(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  WITH translated AS (
    SELECT translate(
      coalesce(value, ''),
      '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
      '01234567890123456789'
    ) AS raw
  ),
  parts AS (
    SELECT
      raw,
      raw ~ '^\s*\+' AS had_plus,
      regexp_replace(raw, '[^0-9]', '', 'g') AS digits
    FROM translated
  )
  SELECT CASE
    WHEN digits = '' THEN NULL
    WHEN digits LIKE '00%' THEN '+' || substring(digits FROM 3)
    WHEN had_plus THEN '+' || digits
    WHEN digits ~ '^0[0-9]{10}$' THEN '+20' || substring(digits FROM 2)
    WHEN digits ~ '^20[0-9]{10}$' THEN '+' || digits
    ELSE digits
  END
  FROM parts;
$function$;

CREATE OR REPLACE FUNCTION portal_normalize_email(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT NULLIF(lower(btrim(coalesce(value, ''))), '');
$function$;

CREATE OR REPLACE FUNCTION portal_normalize_company_name(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT NULLIF(
    regexp_replace(lower(btrim(coalesce(value, ''))), '\s+', ' ', 'g'),
    ''
  );
$function$;

ALTER TABLE portal_customers
  ADD COLUMN IF NOT EXISTS normalized_phone text,
  ADD COLUMN IF NOT EXISTS normalized_email text,
  ADD COLUMN IF NOT EXISTS normalized_company_name text;

ALTER TABLE portal_applications
  ADD COLUMN IF NOT EXISTS normalized_phone text,
  ADD COLUMN IF NOT EXISTS normalized_email text,
  ADD COLUMN IF NOT EXISTS normalized_company_name text;

ALTER TABLE portal_activation_requests
  ADD COLUMN IF NOT EXISTS normalized_phone text,
  ADD COLUMN IF NOT EXISTS normalized_company_name text;

UPDATE portal_customers
SET
  normalized_phone = portal_normalize_phone(phone),
  normalized_email = portal_normalize_email(email),
  normalized_company_name = portal_normalize_company_name(company_name);

UPDATE portal_applications
SET
  normalized_phone = portal_normalize_phone(phone),
  normalized_email = portal_normalize_email(email),
  normalized_company_name = portal_normalize_company_name(company_name);

UPDATE portal_activation_requests
SET
  normalized_phone = portal_normalize_phone(phone_entered),
  normalized_company_name = portal_normalize_company_name(company_name_entered);

CREATE OR REPLACE FUNCTION portal_customers_identity_normalize_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.normalized_phone := portal_normalize_phone(NEW.phone);
  NEW.normalized_email := portal_normalize_email(NEW.email);
  NEW.normalized_company_name := portal_normalize_company_name(NEW.company_name);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION portal_applications_identity_normalize_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.normalized_phone := portal_normalize_phone(NEW.phone);
  NEW.normalized_email := portal_normalize_email(NEW.email);
  NEW.normalized_company_name := portal_normalize_company_name(NEW.company_name);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION portal_activation_requests_identity_normalize_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.normalized_phone := portal_normalize_phone(NEW.phone_entered);
  NEW.normalized_company_name :=
    portal_normalize_company_name(NEW.company_name_entered);
  RETURN NEW;
END;
$function$;

DO $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'portal_customers_identity_normalize'
      AND tgrelid = 'portal_customers'::regclass
  ) THEN
    CREATE TRIGGER portal_customers_identity_normalize
    BEFORE INSERT OR UPDATE OF phone, email, company_name
    ON portal_customers
    FOR EACH ROW
    EXECUTE FUNCTION portal_customers_identity_normalize_trigger();
  END IF;
END
$function$;

DO $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'portal_applications_identity_normalize'
      AND tgrelid = 'portal_applications'::regclass
  ) THEN
    CREATE TRIGGER portal_applications_identity_normalize
    BEFORE INSERT OR UPDATE OF phone, email, company_name
    ON portal_applications
    FOR EACH ROW
    EXECUTE FUNCTION portal_applications_identity_normalize_trigger();
  END IF;
END
$function$;

DO $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'portal_activation_requests_identity_normalize'
      AND tgrelid = 'portal_activation_requests'::regclass
  ) THEN
    CREATE TRIGGER portal_activation_requests_identity_normalize
    BEFORE INSERT OR UPDATE OF phone_entered, company_name_entered
    ON portal_activation_requests
    FOR EACH ROW
    EXECUTE FUNCTION portal_activation_requests_identity_normalize_trigger();
  END IF;
END
$function$;

CREATE INDEX IF NOT EXISTS portal_customers_normalized_phone_idx
  ON portal_customers (normalized_phone);
CREATE INDEX IF NOT EXISTS portal_customers_normalized_email_idx
  ON portal_customers (normalized_email);
CREATE INDEX IF NOT EXISTS portal_customers_normalized_company_name_idx
  ON portal_customers (normalized_company_name);
CREATE INDEX IF NOT EXISTS portal_applications_normalized_phone_idx
  ON portal_applications (normalized_phone);
CREATE INDEX IF NOT EXISTS portal_applications_normalized_email_idx
  ON portal_applications (normalized_email);
CREATE INDEX IF NOT EXISTS portal_applications_normalized_company_name_idx
  ON portal_applications (normalized_company_name);
CREATE INDEX IF NOT EXISTS portal_activation_requests_normalized_phone_idx
  ON portal_activation_requests (normalized_phone);
CREATE INDEX IF NOT EXISTS portal_activation_requests_normalized_company_name_idx
  ON portal_activation_requests (normalized_company_name);

DO $function$
DECLARE
  conflict_row record;
  conflict_count integer;
BEGIN
  SELECT count(*) INTO conflict_count
  FROM (
    SELECT normalized_phone
    FROM portal_customers
    WHERE normalized_phone IS NOT NULL
    GROUP BY normalized_phone
    HAVING count(*) > 1
  ) conflicts;

  IF conflict_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS portal_customers_normalized_phone_unique
      ON portal_customers (normalized_phone)
      WHERE normalized_phone IS NOT NULL;
  ELSE
    FOR conflict_row IN
      SELECT array_agg(id ORDER BY id) AS row_ids
      FROM portal_customers
      WHERE normalized_phone IS NOT NULL
      GROUP BY normalized_phone
      HAVING count(*) > 1
    LOOP
      RAISE WARNING
        'Identity normalization conflict: portal_customers.normalized_phone row_ids=%; unique index not created',
        conflict_row.row_ids;
    END LOOP;
  END IF;

  SELECT count(*) INTO conflict_count
  FROM (
    SELECT normalized_email
    FROM portal_customers
    WHERE normalized_email IS NOT NULL
    GROUP BY normalized_email
    HAVING count(*) > 1
  ) conflicts;

  IF conflict_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS portal_customers_normalized_email_unique
      ON portal_customers (normalized_email)
      WHERE normalized_email IS NOT NULL;
  ELSE
    FOR conflict_row IN
      SELECT array_agg(id ORDER BY id) AS row_ids
      FROM portal_customers
      WHERE normalized_email IS NOT NULL
      GROUP BY normalized_email
      HAVING count(*) > 1
    LOOP
      RAISE WARNING
        'Identity normalization conflict: portal_customers.normalized_email row_ids=%; unique index not created',
        conflict_row.row_ids;
    END LOOP;
  END IF;
END
$function$;