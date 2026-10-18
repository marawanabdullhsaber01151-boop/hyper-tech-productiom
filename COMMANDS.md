# COMMANDS — hardening-2

> ⚠️ الحزمة فيها هجرة قاعدة بيانات: **خد نسخة احتياطية (pg_dump أو فرع Neon) قبل ما تبدأ.**

## ١) نسخ الملفات فوق المشروع
```bash
# من جذر المشروع، و<PKG> = مجلد الحزمة المفكوكة
cp -R <PKG>/files/. .
```
```powershell
Copy-Item -Recurse -Force "<PKG>\files\*" .
```

## ٢) مسح الملفات المحذوفة (0)
```bash
# لا يوجد ملفات للمسح
```
```powershell
# لا يوجد ملفات للمسح
```

## ٣) الحزم والبيئة
- مفيش تغيير في الحزم.
- راجع `.env.example` لو فيه متغير جديد وضيفه في Vercel/`.env`.

## ٤) الهجرات والتحقق
```bash
npm run db:migrate
npm run check:all
npm run check:e2e
node scripts/delivery-pack.mjs verify --dir <مسار-مجلد-الحزمة-المفكوكة> --root .
```

## ٥) الرجوع (Rollback)
- الكود: ارجع للنسخة السابقة من ملفات الحزمة (git checkout أو النسخة الاحتياطية للمجلد)، وأعد النشر.
- هجرة `migrations/0078_portal_customer_archive.sql`:
```sql
  DROP INDEX IF EXISTS portal_customers_archived_at_idx;
  ALTER TABLE portal_customers DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by_user_id, DROP COLUMN IF EXISTS archive_reason;
```
- لو الهجرة اتنفذت وفيها بيانات: استرجع من النسخة الاحتياطية اللي أخدتها قبل التنفيذ.
