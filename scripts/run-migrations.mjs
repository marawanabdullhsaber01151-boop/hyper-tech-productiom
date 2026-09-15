/**
 * ✅ سكريبت تشغيل migrations من التيرمنال مباشرة — بديل عن اللصق اليدوي
 * في Neon SQL Editor.
 *
 * ليه محتاجين السكريبت ده تحديدًا بدل "npm run db:migrate" (drizzle-kit
 * migrate) الموجود أصلًا؟ لأن drizzle.config.ts معرّف بـ out: "./drizzle"،
 * يعني drizzle-kit بيدوّر على الـ migrations في مجلد "./drizzle" بس (فيه
 * ملف واحد قديم بس)، بينما كل ملفات المشروع الحقيقية (26+ ملف SQL
 * بما فيهم كل حاجة اتعملت في هذه الجلسة) موجودة في "./migrations" وهي
 * ملفات SQL مكتوبة يدويًا، مش مبنية بصيغة drizzle-kit (مفيش
 * meta/_journal.json). فاستخدام drizzle-kit migrate هيتجاهلهم تمامًا.
 *
 * السكريبت ده:
 *  1. يعمل جدول تتبّع بسيط (_migrations_applied) في قاعدة البيانات نفسها
 *     لو مش موجود، عشان يعرف إيه اللي اتشغّل قبل كده.
 *  2. يقرأ كل ملفات migrations/*.sql بالترتيب الأبجدي (يعني بترتيب الرقم
 *     0001, 0002... تلقائيًا لأن أسماء الملفات مرقّمة).
 *  3. يشغّل بس الملفات اللي لسه متسجلتش كـ "applied"، كل ملف جوه
 *     transaction واحدة (لو فشل السطر يرجع كله، مش نص تنفيذ).
 *  4. آمن للتشغيل المتكرر (idempotent) — تشغيله مرتين من غير خطر.
 *
 * الاستخدام: npm run db:migrate
 * (أو مباشرة: node scripts/run-migrations.mjs)
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import "dotenv/config";
import pkg from "pg";

const { Pool } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");
const baselineSchemaPath = path.join(
  __dirname,
  "..",
  "drizzle",
  "0000_0000_initial_schema.sql",
);

/**
 * The supplied repository has a canonical initial schema in drizzle/, while
 * the real incremental delivery lives in migrations/. A fresh database must
 * receive that baseline before migration 0001 can reference system_users.
 * Existing databases are not rewritten: the marker makes the bootstrap
 * idempotent and the guard rejects a partial/ambiguous database instead of
 * guessing.
 */
async function ensureBaselineSchema(client) {
  const { rows } = await client.query(`
    SELECT
      to_regclass('public.system_users') AS system_users,
      to_regclass('public.inventory_items') AS inventory_items,
      to_regclass('public.contacts') AS contacts
  `);
  const baseline = rows[0];
  if (baseline.system_users && baseline.inventory_items && baseline.contacts) {
    return false;
  }

  const present = [baseline.system_users, baseline.inventory_items, baseline.contacts]
    .filter(Boolean).length;
  if (present > 0) {
    throw new Error(
      "قاعدة البيانات تحتوي جزءًا من الـbaseline فقط؛ أوقف الترحيل وافحصها يدويًا قبل المتابعة.",
    );
  }
  if (!existsSync(baselineSchemaPath)) {
    throw new Error(`ملف baseline غير موجود: ${baselineSchemaPath}`);
  }

  const baselineSql = readFileSync(baselineSchemaPath, "utf8")
    .replaceAll(/--> statement-breakpoint/g, "");
  await client.query("BEGIN");
  try {
    await client.query(baselineSql);
    await client.query(
      `INSERT INTO "_migrations_applied" (filename)
       VALUES ('0000_0000_initial_schema.sql')
       ON CONFLICT (filename) DO NOTHING`,
    );
    await client.query("COMMIT");
    console.log("✅ تم تهيئة baseline schema من drizzle/0000_0000_initial_schema.sql");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "❌ DATABASE_URL مش موجودة. لازم تكون متسجلة في ملف .env قبل تشغيل السكريبت ده.",
    );
    process.exit(1);
  }

  const useStrictSSL = process.env.PGSSL_STRICT === "true";
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useStrictSSL ? true : { rejectUnauthorized: false },
  });

  try {
    // ✅ جدول تتبّع الـ migrations اللي اتشغّلت قبل كده
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "_migrations_applied" (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const bootstrapClient = await pool.connect();
    try {
      await ensureBaselineSchema(bootstrapClient);
    } finally {
      bootstrapClient.release();
    }

    const { rows: appliedRows } = await pool.query(
      `SELECT filename FROM "_migrations_applied"`,
    );
    const applied = new Set(appliedRows.map((r) => r.filename));

    const allFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort(); // ترتيب أبجدي = ترتيب رقمي لأن الأسماء مرقّمة 0001, 0002...

    const pending = allFiles.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log("✅ كل الـ migrations متطبّقة بالفعل — مفيش حاجة جديدة.");
      return;
    }

    console.log(`📋 هيتم تشغيل ${pending.length} migration:`);
    pending.forEach((f) => console.log(`   - ${f}`));
    console.log("");

    for (const file of pending) {
      const filePath = path.join(migrationsDir, file);
      const sql = readFileSync(filePath, "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO "_migrations_applied" (filename) VALUES ($1)`,
          [file],
        );
        await client.query("COMMIT");
        console.log(`✅ ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`❌ ${file} فشل — تم التراجع عن كل تغييراته:`);
        console.error(`   ${err.message}`);
        client.release();
        await pool.end();
        process.exit(1);
      } finally {
        client.release();
      }
    }

    console.log("\n🎉 كل الـ migrations الجديدة اتطبّقت بنجاح.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ خطأ غير متوقع:", err);
  process.exit(1);
});
