#!/usr/bin/env node
/**
 * Resets test/business data while the system is still in testing, WITHOUT
 * touching:
 *   - system_users            (your logins — you would be locked out otherwise)
 *   - system_settings         (company name, currency, VAT rate, ...)
 *   - _migrations_applied     (the migration runner's own history — touching
 *                              this can make it think migrations need to
 *                              re-run, or refuse to run new ones later)
 *
 * Every other table in the "public" schema is discovered automatically from
 * information_schema (not a hand-typed list), so nothing added by a later
 * migration is silently skipped and left with orphaned data.
 *
 * SAFETY:
 *   - Always run with --dry-run first. It prints exactly which tables would
 *     be cleared and touches nothing.
 *   - The real run refuses to do anything unless you type RESET at the
 *     prompt — there is no way to skip this by piping input or a flag, on
 *     purpose, because this command is irreversible.
 *   - Add --keep table_one,table_two to protect additional tables beyond
 *     the three above (e.g. if you seeded reference data you want to keep).
 *
 * Usage:
 *   node scripts/reset-test-data.mjs --dry-run
 *   node scripts/reset-test-data.mjs
 *   node scripts/reset-test-data.mjs --keep foundation_locations,foundation_work_centers
 */
import "dotenv/config";
import readline from "node:readline";
import pkg from "pg";

const { Pool } = pkg;

const ALWAYS_PROTECTED = ["system_users", "system_settings", "_migrations_applied"];

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const keepIndex = argv.indexOf("--keep");
  const keep =
    keepIndex >= 0 && argv[keepIndex + 1]
      ? argv[keepIndex + 1].split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  return { dryRun, keep };
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL غير موجود في البيئة. لم يُنفَّذ أي شيء.");
    process.exit(1);
  }

  const { dryRun, keep } = parseArgs(process.argv.slice(2));
  const protectedTables = new Set([...ALWAYS_PROTECTED, ...keep]);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const allTables = rows.map((r) => r.tablename);
    const toClear = allTables.filter((t) => !protectedTables.has(t));
    const kept = allTables.filter((t) => protectedTables.has(t));

    console.log(`\nقاعدة البيانات: ${maskConnectionString(process.env.DATABASE_URL)}\n`);
    console.log(`سيتم إفراغ ${toClear.length} جدول:`);
    for (const t of toClear) console.log(`  - ${t}`);
    console.log(`\nمحفوظ بدون مساس (${kept.length}):`);
    for (const t of kept) console.log(`  - ${t}`);

    if (toClear.length === 0) {
      console.log("\nلا يوجد أي جدول لإفراغه.");
      return;
    }

    if (dryRun) {
      console.log("\n(--dry-run) لم يتم تنفيذ أي تغيير فعلي.");
      return;
    }

    console.log(
      "\n⚠️  ده إجراء لا يمكن التراجع عنه. كل البيانات في الجداول اللي فوق (كل الأصناف، " +
        "أوامر الإنتاج، المخزون، الوصفات، العملاء... إلخ) هتتمسح نهائيًا.",
    );
    const answer = await confirm('اكتب RESET بالظبط وادوس Enter للتأكيد، أو أي حاجة تانية للإلغاء: ');
    if (answer !== "RESET") {
      console.log("تم الإلغاء — لم يتم تنفيذ أي شيء.");
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const quoted = toClear.map((t) => `"${t}"`).join(", ");
      await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
      await client.query("COMMIT");
      console.log(`\n✅ تم إفراغ ${toClear.length} جدول بنجاح. تسجيلات الدخول والإعدادات وتاريخ الـmigrations لم تتأثر.`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

function maskConnectionString(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return "(تعذّر قراءة عنوان الاتصال)";
  }
}

main().catch((err) => {
  console.error("❌ فشل التنفيذ:", err.message);
  process.exit(1);
});
