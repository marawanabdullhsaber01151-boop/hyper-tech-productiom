/**
 * يسرد كل المستخدمين الموجودين فعليًا في جدول system_users،
 * عشان نعرف هل القاعدة فاضية خالص ولا فيها مستخدمين بأسماء تانية.
 *
 * الاستخدام (بعد ما DATABASE_URL يبقى متسجل زي ما عملت قبل كده):
 *   node list-users.mjs
 */
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("❌ لازم تحدد DATABASE_URL الأول (زي ما عملت في الأمر اللي فات).");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  const url = new URL(process.env.DATABASE_URL);
  console.log(`🔎 القاعدة المتصل بيها: ${url.hostname} / ${url.pathname.replace("/", "")}\n`);
} catch {}

const { rows } = await pool.query(
  "SELECT id, username, role, status, created_at FROM system_users ORDER BY id",
);

if (rows.length === 0) {
  console.log("📭 الجدول system_users فاضي تمامًا — مفيش أي مستخدم اتعمله seed في القاعدة دي خالص.");
} else {
  console.log(`📋 لقيت ${rows.length} مستخدم/مستخدمين:\n`);
  for (const r of rows) {
    console.log(`  id=${r.id} | username="${r.username}" | role=${r.role} | status=${r.status} | created_at=${r.created_at}`);
  }
}

await pool.end();
