# أوامر خطة 05 (إدارة عملاء البوابة)

انسخ الملفات فوق المشروع، وبعدين:

```
npm install
npm run db:migrate
npm run build:web
git add -A && git commit -m "feat: portal companies admin (plan 05)" && git push
```

بعد النشر على Vercel:
1. اعمل Hard refresh.
2. افتح بالرابط مباشرة: `/v2/admin/portal-customers` (لازم تكون داخل بحساب موظف مبيعات أو مدير).
3. جرّب الصفحة. لو عجبتك: من `/v2/admin/portal-customers/settings` شغّل مفتاح «إدارة عملاء البوابة» تحت «الواجهة الجديدة»، وبعدها الصفحة القديمة هتحوّل للجديدة لوحدها.
4. للرجوع للقديمة: اقفل المفتاح، أو افتح الصفحة القديمة بـ `?legacy=1`.
