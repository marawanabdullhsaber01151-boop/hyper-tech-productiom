# إصلاح 2: قايمة الاستعادة + أكواد الاسترجاع + التحويل للواجهة الجديدة

## 1) انسخ الملفات
فك `Plan04-fix2.zip` فوق مجلد المشروع (نفس المسارات). انشر على Vercel وسوّي Hard refresh.

## 2) اشتغل (من مجلد المشروع على جهازك)
```bash
node scripts/smoke-check.mjs https://دومينك.vercel.app
node --env-file=.env scripts/set-v2-flag.mjs on
```
- الأول بيفحص الموقع (كل سطر لازم ✓).
- التاني بيشغّل الواجهة الجديدة. للرجوع للقديمة: `off` بدل `on`.
- ملف `.env` لازم يكون فيه `DATABASE_URL` بتاع Neon.

## 3) جرّب
`docs/reports/04-checklist.md`
