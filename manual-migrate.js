// manual-migrate.js
// يشغّل بـ: railway run node manual-migrate.js
// بيضيف بس الأعمدة الجديدة المطلوبة لجدول production_workflow_orders و production_orders
// من غير ما يلمس أي جدول أو عمود تاني في النظام.

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const statements = [
  `ALTER TABLE "production_orders" ALTER COLUMN "stages" SET DEFAULT '[]'`,
  `ALTER TABLE "production_workflow_orders" ALTER COLUMN "requested_materials" SET DEFAULT '[]'`,
  `ALTER TABLE "production_workflow_orders" ADD COLUMN IF NOT EXISTS "delivery_initiated_by_id" integer`,
  `ALTER TABLE "production_workflow_orders" ADD COLUMN IF NOT EXISTS "delivery_initiated_by_name" text`,
  `ALTER TABLE "production_workflow_orders" ADD COLUMN IF NOT EXISTS "delivery_initiated_at" timestamp with time zone`,
  `ALTER TABLE "production_workflow_orders" ADD COLUMN IF NOT EXISTS "pending_delivery_inventory_item_id" integer`,
  `ALTER TABLE "production_workflow_orders" ADD COLUMN IF NOT EXISTS "pending_delivery_add_to_inventory" boolean DEFAULT false`,
];

async function run() {
  const client = await pool.connect();
  try {
    for (const sql of statements) {
      console.log("→", sql);
      await client.query(sql);
      console.log("  ✓ تم");
    }

    // إضافة الـ foreign key بس لو مش موجود أصلاً (تجنب خطأ لو اتنفذ قبل كده)
    const fkCheck = await client.query(`
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'quality_records_workflow_order_id_production_workflow_orders_id_fk'
    `);
    if (fkCheck.rowCount === 0) {
      console.log("→ إضافة FK لجدول quality_records");
      await client.query(`
        ALTER TABLE "quality_records"
        ADD CONSTRAINT "quality_records_workflow_order_id_production_workflow_orders_id_fk"
        FOREIGN KEY ("workflow_order_id") REFERENCES "public"."production_workflow_orders"("id")
        ON DELETE cascade ON UPDATE no action
      `);
      console.log("  ✓ تم");
    } else {
      console.log("→ الـ FK موجود بالفعل، تم التخطي");
    }

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
