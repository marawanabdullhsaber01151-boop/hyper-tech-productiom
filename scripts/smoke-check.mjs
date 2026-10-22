#!/usr/bin/env node
/**
 * فحص سريع للموقع المنشور (من غير تسجيل دخول).
 *   node scripts/smoke-check.mjs https://دومينك.vercel.app
 */
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("اكتب رابط الموقع كامل. مثال: node scripts/smoke-check.mjs https://example.vercel.app");
  process.exit(1);
}
let bad = 0;
async function check(name, path, test) {
  try {
    const r = await fetch(base + path, { redirect: "manual" });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const res = await test(r, json, text);
    if (res === true) console.log(`✓ ${name}`);
    else { bad++; console.log(`✗ ${name} — ${res || `الرد ${r.status}`}`); }
  } catch (e) {
    bad++;
    console.log(`✗ ${name} — مفيش اتصال (${e.message})`);
  }
}
const data = (j) => (j && "data" in j ? j.data : j);

await check("السيرفر شغّال", "/api/v1/health", (r) => r.ok || `الرد ${r.status}`);
await check("طرق استعادة كلمة السر (لازم migration الخطة 02 و03)", "/api/v1/portal/recovery/methods", (r, j) => {
  if (!r.ok) return `الرد ${r.status} — غالبًا الـ migrations ماتطبّقتش. شغّل: npm run db:migrate`;
  const m = data(j)?.methods;
  return Array.isArray(m) && m.length > 0 || "القايمة فاضية";
});
await check("إعدادات البوابة", "/api/v1/portal/config", (r) => r.ok || `الرد ${r.status}`);
await check("الواجهة الجديدة /v2/portal/login", "/v2/portal/login", (r, _j, t) => (r.ok && t.includes("<div id=")) || `الرد ${r.status} — اتأكد إن npm run build اشتغل على Vercel`);
await check("رابط الصفحة القديمة بيتحوّل للجديدة", "/portal-recover.html", (r) => ((r.status === 301 || r.status === 302) && (r.headers.get("location") ?? "").includes("/v2/portal/recover")) || `الرد ${r.status} — المفروض تحويل لـ /v2/portal/recover`);
console.log(bad ? `\nفي ${bad} مشكلة. ابعتلي السطور اللي فيها ✗.` : "\nكله تمام ✓");
process.exit(bad ? 1 : 0);
