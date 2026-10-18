# COMMANDS — phase-1-staff-shell

> الحزمة مفيهاش هجرات قاعدة بيانات.

## ١) نسخ الملفات فوق المشروع
```bash
# من جذر المشروع، و<PKG> = مجلد الحزمة المفكوكة
cp -R <PKG>/files/. .
```
```powershell
Copy-Item -Recurse -Force "<PKG>\files\*" .
```

## ٢) مسح الملفات المحذوفة (1)
```bash
rm -f "public/login.html"
```
```powershell
Remove-Item -LiteralPath "public\login.html" -Force -ErrorAction SilentlyContinue
```
> مجلدات ممكن تفضل فاضية بعد المسح: `public` — امسحها لو فاضية.

## ٣) الحزم والبيئة
- مفيش تغيير في الحزم.
- راجع `.env.example` لو فيه متغير جديد وضيفه في Vercel/`.env`.

## ٤) الهجرات والتحقق
```bash
npm run check:all
node scripts/delivery-pack.mjs verify --dir <مسار-مجلد-الحزمة-المفكوكة> --root .
```

## ٥) الرجوع (Rollback)
- الكود: ارجع للنسخة السابقة من ملفات الحزمة (git checkout أو النسخة الاحتياطية للمجلد)، وأعد النشر.
- مفيش هجرات تحتاج رجوع.
- لو الهجرة اتنفذت وفيها بيانات: استرجع من النسخة الاحتياطية اللي أخدتها قبل التنفيذ.
