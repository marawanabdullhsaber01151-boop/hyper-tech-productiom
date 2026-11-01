/**
 * فحص النصوص:
 * 1) كل t("key") في الكود ليه نص.
 * 2) نصوص الجموع فيها "other".
 * 3) مفيش مفتاح متكرر بين ملفين.
 * 4) الصفحات الكبيرة (lazy-dicts) خارج الحزمة الرئيسية: أي ملف فيه مفتاح من قاموس منها لازم يعمل له import صريح
 *    (import "../copy/<الاسم>")، وملف lazy-dicts نفسه ممنوع يتعمل له import من كود التطبيق.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ar } from "../src/copy/ar";
import { lazyCopies } from "../src/copy/lazy-dicts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
/** مسارات بشرطة مائلة ثابتة (ويندوز بيرجّع \\) عشان فحوص المسارات تشتغل على كل الأنظمة. */
const posix = (p: string) => p.split(sep).join("/");
const files: string[] = [];
(function walk(d: string) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !posix(p).includes("/src/test/")) files.push(p);
  }
})(root);

const problems: string[] = [];
const rel = (f: string) => posix(f).replace(posix(root), "src");

// مالك كل مفتاح + كشف التكرار.
const owner = new Map<string, string>();
for (const k of Object.keys(ar)) owner.set(k, "ar");
for (const [name, dict] of Object.entries(lazyCopies)) {
  for (const k of Object.keys(dict)) {
    const prev = owner.get(k);
    if (prev) problems.push(`المفتاح "${k}" متكرر في ${prev} و ${name}`);
    owner.set(k, name);
  }
}
const all: Record<string, unknown> = { ...ar };
for (const dict of Object.values(lazyCopies)) Object.assign(all, dict);

const used = new Set<string>();
const keyLiteral = /["'`]([\w]+(?:\.[\w]+)+)["'`]/g;
for (const f of files) {
  const inCopyDir = posix(f).startsWith(`${posix(root)}/copy/`);
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt\(\s*["'`]([\w.]+)["'`]/g)) {
    used.add(m[1]!);
    if (!(m[1]! in all)) problems.push(`${rel(f)}: المفتاح "${m[1]}" مش موجود في نصوص النظام`);
  }
  if (inCopyDir) continue;
  // أي حرف حرفي بيساوي مفتاح من قاموس كسول (حتى لو متخزن في جدول أو متغيّر) لازم الملف يعمل import لقاموسه.
  const need = new Set<string>();
  for (const m of src.matchAll(keyLiteral)) {
    const o = owner.get(m[1]!);
    if (o && o !== "ar") {
      need.add(o);
      used.add(m[1]!);
    }
  }
  for (const name of need) {
    const re = new RegExp(`import\\s+(?:[^;]*?\\sfrom\\s+)?["'][./]+/copy/${name}["']`);
    if (!re.test(src)) problems.push(`${rel(f)}: بيستخدم مفاتيح من copy/${name} من غير import "…/copy/${name}" (النص مش هيتحمّل مع الصفحة)`);
  }
  if (/copy\/lazy-dicts/.test(src)) problems.push(`${rel(f)}: ممنوع import لـ copy/lazy-dicts من كود التطبيق (للفحص والاختبارات بس)`);
}
for (const [k, v] of Object.entries(all)) {
  if (typeof v !== "string" && !(v && typeof v === "object" && "other" in v)) problems.push(`"${k}" جمع من غير other`);
}
const unused = Object.keys(all).filter((k) => !used.has(k));
console.log(`copy: ${Object.keys(all).length} نص، ${used.size} مستخدم، ${unused.length} لسه مش مستخدم (عادي — هيتستخدموا في الصفحات).`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("فحص النصوص: تمام ✓");
