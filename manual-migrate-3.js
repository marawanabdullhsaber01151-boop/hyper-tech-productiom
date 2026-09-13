/** @format */

// manual-migrate-3.js
// يشغّل بـ: railway run node manual-migrate-3.js
// بينشئ جدول login_sessions + قيد فريد على الحضور.
// ما بيلمسش أي جدول أو عمود تاني في النظام.

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    console.log("→ إنشاء جدول login_sessions ...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS "login_sessions" (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL REFERENCES "system_users"("id") ON DELETE CASCADE,
        "device_info" text,
        "ip_address" text,
        "is_new_device" boolean NOT NULL DEFAULT false,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "last_active_at" timestamp with time zone NOT NULL DEFAULT now(),
        "revoked_at" timestamp with time zone,
        "revoked_by" integer REFERENCES "system_users"("id"),
        "revoked_reason" text
      )
    `);
    console.log("  ✓ تم");

    console.log("→ إنشاء index على login_sessions.user_id ...");
    await client.query(
      `CREATE INDEX IF NOT EXISTS "login_sessions_user_idx" ON "login_sessions" USING btree ("user_id")`,
    );
    console.log("  ✓ تم");

    // ✅ فحص أمان قبل إضافة القيد الفريد على الحضور — لو فيه تكرارات
    // موجودة بالفعل، القيد هيفشل. نفحص الأول عشان نطلعلك تقرير واضح
    // بدل خطأ غامض.
    console.log("→ فحص وجود تكرارات في سجلات الحضور الحالية ...");
    const dupCheck = await client.query(`
      SELECT employee_id, date, COUNT(*) as cnt
      FROM attendance_logs
      GROUP BY employee_id, date
      HAVING COUNT(*) > 1
    `);

    if (dupCheck.rows.length > 0) {
      console.log("\n⚠️  لقيت تكرارات موجودة بالفعل في جدول الحضور:");
      console.table(dupCheck.rows);
      console.log(
        "\nمش هينفع نضيف القيد الفريد قبل ما التكرارات دي تتحل يدويًا " +
          "(تشوف كل حالة وتقرر تمسح أنهي سجل من الاتنين). القيد اتأجل، وباقي " +
          "الجدول الجديد (login_sessions) اتعمل بنجاح.",
      );
    } else {
      console.log("  ✓ مفيش تكرارات — آمن نضيف القيد");
      console.log("→ إضافة القيد الفريد على الحضور (موظف + تاريخ) ...");
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "attendance_employee_date_unique" ON "attendance_logs" USING btree ("employee_id", "date")`,
      );
      console.log("  ✓ تم");
    }

    console.log("\n✅ التعديلات المطلوبة اتنفذت.");
  } catch (err) {
    console.error("\n❌ حصل خطأ:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
