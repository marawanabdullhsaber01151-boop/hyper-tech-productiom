# أوامر Plan 02 (انسخ الملفات فوق مشروعك بنفس المسارات)

## 1) في التيرمنال داخل مشروعك
```bash
npm install                          # مفيش dependencies جديدة، للتأكيد بس
npm run db:migrate                   # بيشغّل 0070 و 0071 (آمنين لو اتشغلوا قبل كده)
npm run db:migrate:identity          # تجربة بس: بتعرض اللي هيتعمل ومش بتغيّر حاجة
npm run db:migrate:identity -- --apply   # بتعمل مستخدم + رئيس + كود لكل شركة موجودة
npm test                             # اختياري
```
شغّلها على Neon بنفس `DATABASE_URL` اللي في `.env`. لو ظهر "تعارض" في التجربة ابعتلي السطر قبل ما تعمل `--apply`.

## 2) الرفع
```bash
git add -A && git commit -m "plan02: identity, team, join, per-member orders" && git push
```
Vercel هيعمل deploy لوحده. بعدها اعمل Hard Refresh للمتصفح (Ctrl+Shift+R).

## 3) متغيرات Vercel
مفيش متغيرات إجبارية جديدة. اختياريين (القيم دي هي الافتراضية):
`LOGIN_RATE_MAX=10`، `PORTAL_ACCOUNT_LOGIN_RATE_MAX=5`، `PORTAL_JOIN_RATE_MAX_IP=20`، `PORTAL_JOIN_RATE_MAX_PHONE=8`.

## 4) لو حصلت مشكلة
الجداول الجديدة إضافة بس، فالرجوع للكود القديم آمن (الباسورد القديم لسه متزامن).
