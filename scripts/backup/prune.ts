/**
 * يقرا مفاتيح النسخ من stdin (مفتاح في كل سطر) ويطبع المفاتيح اللي لازم تتمسح بسياسة الاحتفاظ.
 * بيرفض (exit 3) لو هيمسح أكتر من نص النسخ مرة واحدة. ما بيلمسش أي مفتاح اسمه مش بتاعنا.
 */
import { readFileSync } from "node:fs";
import { planRetention, pruneIsSafe } from "../../src/lib/backupCore";

const keys = readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
const { keep, prune } = planRetention(keys, new Date());
if (!pruneIsSafe(keep.length + prune.length, prune.length)) {
  console.error(`رفضت المسح: هيمسح ${prune.length} من ${keep.length + prune.length} نسخة مرة واحدة. راجع الساعة أو الأسماء.`);
  process.exit(3);
}
for (const k of prune) console.log(k);
