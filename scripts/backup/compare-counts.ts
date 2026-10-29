/**
 * مقارنة عدد صفوف القاعدة المسترجعة بالمسجّل في manifest وقت النسخ. بيطبع تقرير Markdown بالعربي (لملخص GitHub)،
 * وبيخرج بـ 1 لو في أي جدول مختلف أو ناقص.
 *   tsx compare-counts.ts <manifest.json> <restored-counts.json> <store>
 */
import { readFileSync } from "node:fs";
import { compareRowCounts, type RowCounts } from "../../src/lib/backupCore";

const [manifestPath, restoredPath, store = ""] = process.argv.slice(2);
if (!manifestPath || !restoredPath) {
  console.error("الاستخدام: compare-counts.ts <manifest.json> <restored.json> <store>");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { objectKey: string; countsBefore: RowCounts; countsAfter: RowCounts };
const restored = JSON.parse(readFileSync(restoredPath, "utf8")) as RowCounts;
const r = compareRowCounts(manifest.countsBefore, manifest.countsAfter, restored);

const lines = [`### اختبار الاسترجاع (${store.toUpperCase()}): ${r.ok ? "✅ مطابق" : "❌ فيه فروق"}`, "", `النسخة: \`${manifest.objectKey}\``, `الجداول: ${r.tables} | إجمالي الصفوف المسترجعة: ${r.rows}`];
if (!r.ok) {
  lines.push("", "| الجدول | المسترجع | المتوقع |", "|---|---|---|");
  for (const d of r.diffs) {
    const exp = d.min === null ? "—" : d.min === d.max ? String(d.min) : `${d.min} إلى ${d.max}`;
    lines.push(`| ${d.table} | ${d.restored ?? "ناقص"} | ${exp} |`);
  }
}
console.log(lines.join("\n"));
process.exit(r.ok ? 0 : 1);
