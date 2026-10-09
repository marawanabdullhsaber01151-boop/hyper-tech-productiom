/**
 * فحص إمكانية الوصول في Chromium حقيقي (الألوان والـ layout):
 *   npm run build:web && node web/scripts/a11y-browser.mjs
 * بيشغّل سيرفر ثابت على public/ ويفتح gallery في فاتح/غامق × desktop/mobile.
 * محتاج playwright و chromium (ميتثبتوش مع المشروع — ده فحص اختياري يدوي/CI).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, "../../public");
const axeSrc = fs.readFileSync(path.resolve(here, "../../node_modules/axe-core/axe.min.js"), "utf8");
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log("playwright مش متثبّت — تخطّي الفحص.");
  process.exit(0);
}
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const p = path.join(pub, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (e, d) => (e ? (res.writeHead(404), res.end()) : (res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream" }), res.end(d))));
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let bad = 0;
for (const [scheme, vp] of [["light", { width: 1280, height: 900 }], ["dark", { width: 1280, height: 900 }], ["light", { width: 390, height: 844 }], ["dark", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: vp });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/v2/gallery.html`, { waitUntil: "networkidle" });
  await page.evaluate(axeSrc);
  const r = await page.evaluate(() => axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log(`${scheme} ${vp.width}px: ${r.violations.length} مخالفة${overflow ? " + سكرول أفقي!" : ""}`);
  for (const v of r.violations) console.log("  -", v.id, v.nodes[0]?.html?.slice(0, 120));
  bad += r.violations.length + (overflow ? 1 : 0);
  await ctx.close();
}
await browser.close();
server.close();
process.exit(bad ? 1 : 0);
