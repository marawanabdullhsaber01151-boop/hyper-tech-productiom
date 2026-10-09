/** يقيس حجم الباندل بعد gzip من manifest ويقارنه بـ web/budgets.json. */
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../../public/v2");
const budgets = JSON.parse(readFileSync(resolve(here, "../budgets.json"), "utf8")) as Record<string, number>;
const manifest = JSON.parse(readFileSync(join(dist, ".vite/manifest.json"), "utf8")) as Record<string, { file: string; css?: string[]; imports?: string[]; isEntry?: boolean; dynamicImports?: string[] }>;

const gz = (f: string) => gzipSync(readFileSync(join(dist, f))).length / 1024;

/** كل الملفات اللي بتتحمّل مع entry واحد (من غير الـ dynamic imports زي QR). */
function entryAssets(key: string, seen = new Set<string>()) {
  const e = manifest[key];
  if (!e || seen.has(key)) return { js: [] as string[], css: [] as string[] };
  seen.add(key);
  let js = [e.file];
  let css = [...(e.css ?? [])];
  for (const i of e.imports ?? []) {
    const r = entryAssets(i, seen);
    js = js.concat(r.js);
    css = css.concat(r.css);
  }
  return { js, css };
}

let fail = false;
const row = (name: string, v: number, max: number) => {
  const ok = v <= max;
  if (!ok) fail = true;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${v.toFixed(1)}KB / ${max}KB`);
};

const entries = Object.entries(manifest).filter(([, v]) => v.isEntry);
for (const [key] of entries) {
  const { js, css } = entryAssets(key);
  row(`${key} JS (gz)`, js.reduce((a, f) => a + gz(f), 0), budgets.portalJsGzKb!);
  row(`${key} CSS (gz)`, [...new Set(css)].reduce((a, f) => a + gz(f), 0), budgets.cssGzKb!);
}
const fonts = readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".woff2"));
row("الخطوط (كلها)", fonts.reduce((a, f) => a + readFileSync(join(dist, "assets", f)).length / 1024, 0), budgets.fontsKbTotal!);
if (fail) {
  console.error("الميزانية اتعدّت");
  process.exit(1);
}
console.log("الميزانية: تمام ✓");
