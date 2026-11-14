/** @format */
// الاستعمال: npm audit --omit=dev --json > audit.json; tsx scripts/audit-gate.ts audit.json
import { readFileSync } from "node:fs";
import { evaluateAudit, gateFails, type AllowEntry } from "../src/lib/auditGateCore";

const file = process.argv[2];
if (!file) { console.error("مطلوب مسار ملف ناتج npm audit --json"); process.exit(2); }
const audit = JSON.parse(readFileSync(file, "utf8"));
const allow = JSON.parse(readFileSync(new URL("../docs/audit-allowlist.json", import.meta.url), "utf8")) as AllowEntry[];
const today = new Date().toISOString().slice(0, 10);
const r = evaluateAudit(audit, allow, today);
for (const f of r.allowed) console.log(`مسموح (بقرار مكتوب): ${f.pkg} ${f.id} [${f.severity}] ${f.title}`);
for (const f of r.expired) console.error(`انتهى السماح، لازم تراجعه: ${f.pkg} ${f.id} [${f.severity}] ${f.title}`);
for (const f of r.blocked) console.error(`ثغرة ممنوعة: ${f.pkg} ${f.id} [${f.severity}] ${f.title}`);
if (gateFails(r)) process.exit(1);
console.log("بوابة npm audit: تمام (صفر ثغرات high/critical غير مسموح بيها)");
