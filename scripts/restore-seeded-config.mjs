#!/usr/bin/env node
/**
 * يشغّل scripts/restore-seeded-config.sql مباشرة من ترمنال المشروع —
 * بدون الحاجة لـ psql أو أي أداة PostgreSQL خارجية، بنفس أسلوب باقي
 * سكريبتات db: الموجودة (scripts/run-migrations.mjs).
 *
 * الاستخدام:
 *   node scripts/restore-seeded-config.mjs
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pkg from "pg";

const { Pool } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL غير موجود في البيئة (ملف .env). لم يُنفَّذ أي شيء.");
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, "restore-seeded-config.sql");
  const sql = readFileSync(sqlPath, "utf8");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    console.log("جارٍ استعادة بيانات الإعداد الأساسية (عدادات المستندات، سياسات الاعتماد، ...)...\n");
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("✅ تم بنجاح. جرّب ترسل طلب إنتاج تاني دلوقتي.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ فشل التنفيذ:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
