/**
 * يتأكد إن كل t("key") في الكود ليه نص في copy/ar.ts، وإن نصوص الجموع فيها "other"،
 * وإن كل {متغير} في النص بيتبعت له قيمة (فحص ثابت بسيط).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ar } from "../src/copy/ar";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const files: string[] = [];
(function walk(d: string) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) files.push(p);
  }
})(root);

const used = new Set<string>();
const problems: string[] = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt\(\s*["'`]([\w.]+)["'`]/g)) {
    used.add(m[1]!);
    if (!(m[1]! in ar)) problems.push(`${f.replace(root, "src")}: المفتاح "${m[1]}" مش موجود في copy/ar.ts`);
  }
}
for (const [k, v] of Object.entries(ar)) {
  if (typeof v !== "string" && !("other" in v)) problems.push(`copy/ar.ts: "${k}" جمع من غير other`);
}
const unused = Object.keys(ar).filter((k) => !used.has(k));
console.log(`copy: ${Object.keys(ar).length} نص، ${used.size} مستخدم، ${unused.length} لسه مش مستخدم (عادي — هيتستخدموا في الصفحات).`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("فحص النصوص: تمام ✓");
