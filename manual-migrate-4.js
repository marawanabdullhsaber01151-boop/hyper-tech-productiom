// manual-migrate-4.js
// يشغّل بـ: railway run node manual-migrate-4.js
// بيضيف: عمود الإيميل لعملاء البوابة + جدول طلبات استرجاع الباسورد +
// جدول مراجعات طلبات البوابة. ما بيلمسش أي جدول أو عمود تاني في النظام.

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    console.log("→ إضافة عمود email لعملاء البوابة ...");
    await client.query(`ALTER TABLE "portal_customers" ADD COLUMN IF NOT EXISTS "email" text`);
    console.log("  ✓ تم");

    console.log("→ إضافة قيد فرادة الإيميل ...");
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE "portal_customers" ADD CONSTRAINT "portal_customers_email_unique" UNIQUE ("email");
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    console.log("  ✓ تم");

    console.log("→ إنشاء جدول portal_password_reset_requests ...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS "portal_password_reset_requests" (
        "id" serial PRIMARY KEY,
        "portal_customer_id" integer NOT NULL REFERENCES "portal_customers"("id"),
        "status" text NOT NULL DEFAULT 'pending',
        "resolved_by_id" integer,
        "resolved_by_name" text,
        "resolved_at" timestamp with time zone,
        "created_at" timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    console.log("  ✓ تم");

    console.log("→ إنشاء جدول portal_order_reviews ...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS "portal_order_reviews" (
        "id" serial PRIMARY KEY,
        "batch_ref" text NOT NULL,
        "status" text NOT NULL DEFAULT 'confirmed',
        "reply_message" text,
        "reject_reason" text,
        "sales_order_id" integer,
        "reviewed_by_id" integer NOT NULL,
        "reviewed_by_name" text NOT NULL,
        "created_at" timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    console.log("  ✓ تم");

    console.log("→ إضافة قيد فرادة batch_ref ...");
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE "portal_order_reviews" ADD CONSTRAINT "portal_order_reviews_batch_ref_unique" UNIQUE ("batch_ref");
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    console.log("  ✓ تم");

    console.log("\n✅ كل التعديلات المطلوبة اتنفذت بنجاح.");
  } catch (err) {
    console.error("\n❌ حصل خطأ:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
