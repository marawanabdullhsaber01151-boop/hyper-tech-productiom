// manual-migrate-2.js
// يشغّل بـ: railway run node manual-migrate-2.js
// بيضيف بس عمود credit_limit وجدول contact_ledger.
// ما بيلمسش أي جدول أو عمود تاني في النظام — مش هيمسح supplier_id ولا lead_days.

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const statements = [
  `ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "credit_limit" numeric(12, 2)`,
  `CREATE TABLE IF NOT EXISTS "contact_ledger" (
     "id" serial PRIMARY KEY,
     "contact_id" numeric NOT NULL,
     "reference_type" text NOT NULL,
     "reference_id" numeric,
     "amount" numeric(12, 2) NOT NULL,
     "balance_after" numeric(12, 2) NOT NULL,
     "note" text,
     "created_at" timestamp with time zone NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS "contact_ledger_contact_idx" ON "contact_ledger" USING btree ("contact_id")`,
];

async function run() {
  const client = await pool.connect();
  try {
    for (const sql of statements) {
      console.log("→", sql.split("\n")[0], "...");
      await client.query(sql);
      console.log("  ✓ تم");
    }
    console.log("\n✅ كل التعديلات المطلوبة اتنفذت بنجاح — ومفيش أي عمود أو جدول تاني اتلمس.");
  } catch (err) {
    console.error("\n❌ حصل خطأ:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();