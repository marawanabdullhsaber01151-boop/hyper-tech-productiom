/**
 * يسجّل تشغيلة نسخ أو اختبار استرجاع في backup_runs (يقرا كل حاجة من متغيرات RUN_*).
 * لو التسجيل فشل بيرجّع 1 والمستدعي (common.sh) بيكتفي بتحذير ومبيوقفش النسخة.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const e = process.env;

async function main() {
  const url = e.BACKUP_DATABASE_URL || e.DATABASE_URL;
  if (!url) throw new Error("مفيش رابط قاعدة بيانات");
  const counts: Record<string, number> | null = e.RUN_COUNTS_FILE ? (JSON.parse(readFileSync(e.RUN_COUNTS_FILE, "utf8")) as Record<string, number>) : null;
  const values = counts ? Object.values(counts) : [];
  const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO backup_runs (kind, status, store, object_key, size_bytes, sha256, row_counts, tables_count, rows_total, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [e.RUN_KIND, e.RUN_STATUS, e.RUN_STORE, e.RUN_OBJECT_KEY || null, e.RUN_SIZE ? Number(e.RUN_SIZE) : null, e.RUN_SHA256 || null, counts ? JSON.stringify(counts) : null, counts ? Object.keys(counts).length : null, counts ? values.reduce((a, b) => a + b, 0) : null, e.RUN_ERROR ? e.RUN_ERROR.slice(0, 500) : null],
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
