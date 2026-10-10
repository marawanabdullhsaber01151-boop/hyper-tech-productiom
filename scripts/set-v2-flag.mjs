#!/usr/bin/env node
/**
 * يشغّل أو يقفل الواجهة الجديدة لبوابة العميل.
 *   node --env-file=.env scripts/set-v2-flag.mjs on     (شغّل الجديدة)
 *   node --env-file=.env scripts/set-v2-flag.mjs off    (ارجع للقديمة)
 *   node --env-file=.env scripts/set-v2-flag.mjs        (يقولك الحالة)
 * محتاج DATABASE_URL (موجود في ملف .env عندك).
 */
import pg from "pg";

const arg = process.argv[2];
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL مش موجود. شغّل الأمر كده: node --env-file=.env scripts/set-v2-flag.mjs on");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false } });
try {
  if (arg === "on" || arg === "off") {
    await pool.query(
      `INSERT INTO portal_settings (scope, scope_id, key, value, updated_by, updated_at)
       VALUES ('global', NULL, 'ui.v2.portal', $1::jsonb, 'script', now())
       ON CONFLICT (scope, (COALESCE(scope_id, 0)), key)
       DO UPDATE SET value = EXCLUDED.value, updated_by = 'script', updated_at = now()`,
      [arg === "on" ? "true" : "false"],
    );
  }
  const { rows } = await pool.query(`SELECT value FROM portal_settings WHERE scope='global' AND key='ui.v2.portal'`);
  const on = rows[0]?.value === true;
  console.log(on ? "الواجهة الجديدة: شغّالة ✓ (الصفحات القديمة بتحوّل للجديدة)" : "الواجهة الجديدة: مقفولة (الناس على القديمة)");
} catch (e) {
  console.error("فشل:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
