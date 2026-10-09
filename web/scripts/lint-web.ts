/**
 * قواعد الواجهة الجديدة:
 *  1) CSS: ممنوع left/right/margin-left… (logical properties بس)، وممنوع ألوان hex/rgb خارج tokens.
 *  2) TSX/TS: ممنوع نص عربي ثابت خارج copy/ و gallery/ (كل النصوص من copy/ar.ts).
 *  3) ممنوع استيراد أيقونات مباشرة من lucide-preact خارج design/icons.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const problems: string[] = [];
const rel = (p: string) => "web/src/" + relative(root, p);

function walk(d: string, out: string[] = []) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) {
      if (f === "fonts") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

const PHYSICAL = /(^|[\s;{])(left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right|border-top-left-radius|border-top-right-radius|border-bottom-left-radius|border-bottom-right-radius)\s*:/;
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;
const ARABIC = /[؀-ۿ]/;

for (const f of walk(root)) {
  const r = rel(f);
  const src = readFileSync(f, "utf8");
  if (f.endsWith(".css")) {
    const isTokens = /tokens\//.test(f);
    src.split("\n").forEach((line, i) => {
      const code = line.replace(/\/\*.*?\*\//g, "");
      if (PHYSICAL.test(code)) problems.push(`${r}:${i + 1}: خاصية فيزيائية (استخدم logical): ${line.trim()}`);
      if (!isTokens && COLOR_LITERAL.test(code) && !/data:image|ht-share__qr|background: #fff/.test(code))
        problems.push(`${r}:${i + 1}: لون ثابت خارج التوكنز: ${line.trim()}`);
    });
  } else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) {
    const inCopy = /\/copy\//.test(f) || /\/gallery\//.test(f) || /\/design\/tokens\//.test(f);
    if (!inCopy) {
      src.split("\n").forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
        if (/^\s*\*/.test(line) || /\[\u0660-\u0669/.test(line) || /\[٠-٩/.test(line)) return;
        if (ARABIC.test(code)) problems.push(`${r}:${i + 1}: نص عربي ثابت (حطّه في copy/ar.ts): ${line.trim().slice(0, 80)}`);
      });
    }
    if (!/design\/icons\.ts$/.test(f) && /from\s+["']lucide-preact["']/.test(src)) problems.push(`${r}: استورد الأيقونات من design/icons.ts`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\nlint-web: ${problems.length} مشكلة`);
  process.exit(1);
}
console.log("lint-web: تمام ✓");
