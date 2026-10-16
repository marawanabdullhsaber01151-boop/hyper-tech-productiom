# scripts/ — كل سكريبت له أمر npm موثّق

| الأمر | الغرض |
|---|---|
| `npm run db:migrate` | فحص مسبق + تشغيل الهجرات بالترتيب |
| `npm run db:migrate:identity` | ترحيل هوية البوابة (شركة/مستخدم) |
| `npm run db:reset-test` / `db:restore-config` | تصفير بيانات الاختبار / استرجاع الإعدادات الأولية |
| `npm run wipe:customers` | مسح كل العملاء وبياناتهم (خطر) |
| `npm run smoke:site <url>` | فحص سريع للموقع المنشور |
| `npm run smoke:local` / `smoke:chat` | فحص محلي / فحص الشات |
| `npm run test:race` | سباق على طلبات البوابة |
| `npm run check:roles` / `check:sales` / `check:repository` | فحوص اتساق |
| `npm run audit:baseline` / `audit:phase1` / `audit:foundation` / `audit:lifecycle` | تقارير تدقيق بيانات |
| `npm run telegram:webhook` | ضبط webhook بوت تيليجرام |
| `npm run flag:v2` | **مؤقت** — يتحذف في المرحلة ٢ مع علامات `ui.v2.*` |
