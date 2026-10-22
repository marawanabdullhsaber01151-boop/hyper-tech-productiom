#!/usr/bin/env node
/**
 * جرد مسارات الـAPI ومستهلكيها (الخطوة 8).
 *
 *   node scripts/api-consumers.mjs                 # جدول ملخص + قائمة "بدون مستهلك"
 *   node scripts/api-consumers.mjs --json          # نفس النتيجة JSON
 *   node scripts/api-consumers.mjs --check         # يفشل (exit 1) لو في مسار غير مصنّف في docs/api-routes-allowlist.json
 *
 * بيقرأ كل router.get/post/put/patch/delete في src/routes/*.ts، وبيدوّر على كل مسار في:
 *   web      = web/src (من غير الاختبارات)
 *   legacy   = public/ (صفحات وJS قديمة)
 *   tests    = *.test.ts(x) وe2e
 *   scripts  = scripts/
 * "قوي" = المسار كامل ظاهر (مع :param = ${…}). "ضعيف" = آخر جزء ثابت بس (لو الواجهة بتركّب المسار بمتغيّر).
 * مسار بدون أي مستهلك قوي ولا ضعيف = مرشّح للحذف أو القفل — بعد مراجعة بشرية.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "delivery" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const isTest = (f) => /\.test\.tsx?$/.test(f) || f.startsWith("e2e/");

// ── المسارات ────────────────────────────────────────────────────────────
const routeRe = /\b(?:router|[a-zA-Z]+Router)\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2/g;
const routes = [];
for (const file of walk(path.join(ROOT, "src/routes"))) {
  const f = rel(file);
  if (!f.endsWith(".ts") || isTest(f)) continue;
  const src = readFileSync(file, "utf8");
  let m;
  while ((m = routeRe.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length;
    routes.push({ method: m[1].toUpperCase(), path: m[3], file: f, line });
  }
}

// ── المستهلكون ──────────────────────────────────────────────────────────
const groups = { web: [], legacy: [], tests: [], scripts: [] };
const textExt = /\.(tsx?|jsx?|mjs|html)$/;
for (const file of [
  ...walk(path.join(ROOT, "web/src")),
  ...walk(path.join(ROOT, "public")),
  ...walk(path.join(ROOT, "scripts")),
  ...walk(path.join(ROOT, "e2e")),
  ...walk(path.join(ROOT, "src")),
]) {
  const f = rel(file);
  if (!textExt.test(f)) continue;
  if (f === "scripts/api-consumers.mjs") continue;
  const text = readFileSync(file, "utf8");
  if (f.startsWith("src/")) {
    if (isTest(f)) groups.tests.push({ f, text });
    continue; // كود السيرفر نفسه مش "مستهلك"
  }
  if (isTest(f)) groups.tests.push({ f, text });
  else if (f.startsWith("web/src/")) groups.web.push({ f, text });
  else if (f.startsWith("public/")) groups.legacy.push({ f, text });
  else if (f.startsWith("scripts/")) groups.scripts.push({ f, text });
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PARAM = "(?:[^/\\s\"'`?)]+|\\$\\{[^}]*\\})";

function strongRe(p) {
  const parts = p.split("/").map((seg) => (seg.startsWith(":") ? PARAM : esc(seg)));
  // لازم المسار يبدأ من أول نص (علامة اقتباس/backtick) — عشان مسارات صفحات الواجهة (/admin/…) ماتتحسبش استهلاك API.
  return new RegExp("(?<=[\"'`])" + parts.join("/") + "(?![A-Za-z0-9_-])");
}
function weakRe(p) {
  const statics = p.split("/").filter((s) => s && !s.startsWith(":"));
  const last = statics[statics.length - 1];
  if (!last) return null;
  return new RegExp("[/\"'`]" + esc(last) + "(?![A-Za-z0-9_-])");
}

function scan(list, re) {
  if (!re) return [];
  const hit = [];
  for (const g of list) if (re.test(g.text)) hit.push(g.f);
  return hit;
}

const report = routes.map((r) => {
  const s = strongRe(r.path);
  const w = weakRe(r.path);
  const strong = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, scan(v, s)]));
  const weak = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, scan(v, w)]));
  const live = strong.web.length + strong.legacy.length + strong.scripts.length;
  const weakLive = weak.web.length + weak.legacy.length + weak.scripts.length;
  const status = live ? "used" : weakLive ? "weak" : strong.tests.length || weak.tests.length ? "tests-only" : "none";
  return { ...r, strong, weak, status };
});

if (args.has("--json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const by = (st) => report.filter((r) => r.status === st);
console.log(`Total routes: ${report.length}`);
for (const st of ["used", "weak", "tests-only", "none"]) console.log(`  ${st.padEnd(11)} ${by(st).length}`);

for (const st of ["none", "tests-only", "weak"]) {
  const list = by(st);
  if (!list.length) continue;
  console.log(`\n── ${st} (${list.length}) ──`);
  for (const r of list) {
    const where = Object.entries(r.weak)
      .filter(([, v]) => v.length)
      .map(([k, v]) => `${k}:${v.slice(0, 2).join(",")}`)
      .join(" | ");
    console.log(`${r.method.padEnd(6)} ${r.path.padEnd(52)} ${r.file}:${r.line}${where ? "   ← " + where : ""}`);
  }
}

if (args.has("--check")) {
  const allowPath = path.join(ROOT, "docs/api-routes-allowlist.json");
  const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, "utf8")) : {};
  const bad = [...by("none"), ...by("tests-only")].filter((r) => !allow[`${r.method} ${r.path}`]);
  if (bad.length) {
    console.error(`\n✖ ${bad.length} route(s) have no consumer and are not classified in docs/api-routes-allowlist.json:`);
    for (const r of bad) console.error(`  ${r.method} ${r.path}  (${r.file}:${r.line})`);
    process.exit(1);
  }
  console.log("\n✔ every consumer-less route is classified.");
}
