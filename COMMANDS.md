# أوامر Plan 01 — الأساس (نظام التصميم)

انسخ الملفات اللي في الـ zip فوق مشروعك **بنفس المسارات** (فيها مجلد `web/` جديد وتعديلات صغيرة في `package.json` و`src/main.ts` و`vercel.json`).

## 1) في التيرمنال داخل مشروعك
```bash
npm install                 # بيثبّت Vite و Preact و Lucide و Tajawal (dev dependencies)
npm run build               # بيبني السيرفر + الواجهة الجديدة في public/v2 (ويفحص التباين والنصوص والميزانية)
npm test                    # اختبارات الباك إند
npm run test:web            # اختبارات الواجهة الجديدة (59 اختبار)
npm run dev:web             # اختياري: معاينة محلية للمعرض على http://localhost:5174/v2/gallery.html
```
ملحوظة: مفيش migration جديد في الخطة دي، وما تحتاجش تلمس قاعدة البيانات.

## 2) الرفع
```bash
git add -A && git commit -m "plan01: design system + web foundation" && git push
```
Vercel هيعمل `npm run build` وهيبني `public/v2` لوحده. بعدها اعمل Hard Refresh (Ctrl+Shift+R).

## 3) شوف الشغل
افتح: `https://<موقعك>/v2/gallery.html` — ده معرض كل المكوّنات. جرّب من فوق: فاتح/غامق، مريحة/مضغوطة، دافئ/بارد، وألوان العلامة. صغّر الشاشة (أو افتحه من الموبايل) وشوف الجداول بتتحوّل لكروت.

لتغيير لون شركة (من حساب الرئيس أو الإدارة) من الكونسول وإنت داخل البوابة:
```js
const s = JSON.parse(localStorage.getItem("hyper_erp_portal_session") || sessionStorage.getItem("hyper_erp_portal_session"));
await fetch("/api/v1/portal/company/settings", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.token }, body: JSON.stringify({ key: "ui.theme.accent", value: "teal" }) }).then(r => r.json());
await fetch("/api/v1/portal/theme", { headers: { Authorization: "Bearer " + s.token } }).then(r => r.json());
```

## 4) متغيرات Vercel
مفيش إجباري. اختياري: `UI_V2_PAGES=*` (أو أسماء صفحات مفصولة بفاصلة) لتشغيل الصفحات الجديدة لما تتبني.

## 5) لو حصلت مشكلة
الخطة دي بتضيف بس: الصفحات القديمة ما اتغيّرتش. لو بناء `public/v2` فشل على Vercel ابعتلي سطر الخطأ من لوج البناء.
