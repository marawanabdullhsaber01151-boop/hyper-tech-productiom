// يضيف overrides في package.json لإصلاح ثغرات موروثة (body-parser، proxy-addr). آمن لو اتشغّل أكتر من مرة.
import { readFileSync, writeFileSync } from "node:fs";
const want = { "body-parser": "^2.4.0", "proxy-addr": "^2.0.8" };
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.overrides = { ...(pkg.overrides ?? {}), ...want };
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
console.log("overrides:", JSON.stringify(pkg.overrides));
