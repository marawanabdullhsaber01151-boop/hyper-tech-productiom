# COMMANDS — hardening-1

> ⚠️ الحزمة فيها هجرة قاعدة بيانات: **خد نسخة احتياطية (pg_dump أو فرع Neon) قبل ما تبدأ.**

## ١) نسخ الملفات فوق المشروع
```bash
# من جذر المشروع، و<PKG> = مجلد الحزمة المفكوكة
cp -R <PKG>/files/. .
```
```powershell
Copy-Item -Recurse -Force "<PKG>\files\*" .
```

## ٢) مسح الملفات المحذوفة (40)
```bash
rm -f "CHANGE-MANIFEST-PHASE-00.md"
rm -f "CHANGE-MANIFEST-PHASE-1.md"
rm -f "CHANGE-MANIFEST-PHASE-2-PART-1.md"
rm -f "CHANGE-MANIFEST-PHASE-2-PART-2.md"
rm -f "CHANGE-MANIFEST-PHASE-2.md"
rm -f "CHANGE-MANIFEST-PHASE-3-PART-1.md"
rm -f "CHANGE-MANIFEST-PHASE-3-PART-2.md"
rm -f "CHANGE-MANIFEST-PHASE-3-PART-3.md"
rm -f "CHANGE-MANIFEST-PHASE-3.md"
rm -f "CHANGE-MANIFEST-PHASE-4.md"
rm -f "CHANGE-MANIFEST-PHASE-5.md"
rm -f "CHANGE-MANIFEST-SECURITY-HARDENING.md"
rm -f "DELIVERY_MANIFEST.md"
rm -f "FILES_DELIVERED.txt"
rm -f "HYPER-TECH-FIXES-REPORT.md"
rm -f "MANIFEST.txt"
rm -f "PHASE-1-AFFECTED-FILES.md"
rm -f "PHASE-1-MANIFEST.md"
rm -f "PORTAL-ORDERS-FIX-REPORT.md"
rm -f "PORTAL-ROLES-CONSISTENCY-MATRIX.md"
rm -f "README-#U0643#U064a#U0641#U064a#U0629-#U0627#U0644#U062a#U0631#U0643#U064a#U0628.md"
rm -f "SALES-STATUS-TRANSITION-MATRIX.md"
rm -f "STAGE-03-MANIFEST.md"
rm -f "STAGE_00_03_DELIVERY_MANIFEST.md"
rm -f "STAGE_FILES_MANIFEST.md"
rm -f "add-missing-columns.sql"
rm -f "create-portal-customers-table.sql"
rm -f "diagnose-login.mjs"
rm -f "e2e/approval-flow.e2e.test.ts"
rm -f "hyper_erp_backup_2026-08-22.json"
rm -f "list-users.mjs"
rm -f "manual-migrate-2.js"
rm -f "manual-migrate-3.js"
rm -f "manual-migrate-4.js"
rm -f "manual-migrate-foundation.js"
rm -f "manual-migrate.js"
rm -f "migrations.zip"
rm -f "scripts/DELIVERY_MANIFEST.md"
rm -f "src/db/schema/index.ts.phase-07.patch"
rm -f "src/routes/portal.ts.phase-07.patch"
```
```powershell
Remove-Item -LiteralPath "CHANGE-MANIFEST-PHASE-00.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "CHANGE-MANIFEST-PHASE-1.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "CHANGE-MANIFEST-PHASE-2-PART-1.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "CHANGE-MANIFEST-PHASE-2-PART-2.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "CHANGE-MANIFEST-PHASE-2.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "CHANGE-MANIFEST-PHASE-3-PART-1.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "CHANGE-MANIFEST-PHASE-3-PART-2.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "CHANGE-MANIFEST-PHASE-3-PART-3.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "CHANGE-MANIFEST-PHASE-3.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "CHANGE-MANIFEST-PHASE-4.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "CHANGE-MANIFEST-PHASE-5.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "CHANGE-MANIFEST-SECURITY-HARDENING.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "DELIVERY_MANIFEST.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "FILES_DELIVERED.txt" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "HYPER-TECH-FIXES-REPORT.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "MANIFEST.txt" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "PHASE-1-AFFECTED-FILES.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "PHASE-1-MANIFEST.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "PORTAL-ORDERS-FIX-REPORT.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "PORTAL-ROLES-CONSISTENCY-MATRIX.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "README-#U0643#U064a#U0641#U064a#U0629-#U0627#U0644#U062a#U0631#U0643#U064a#U0628.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "SALES-STATUS-TRANSITION-MATRIX.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "STAGE-03-MANIFEST.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "STAGE_00_03_DELIVERY_MANIFEST.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "STAGE_FILES_MANIFEST.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "add-missing-columns.sql" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "create-portal-customers-table.sql" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "diagnose-login.mjs" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "e2e\approval-flow.e2e.test.ts" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "hyper_erp_backup_2026-08-22.json" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "list-users.mjs" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "manual-migrate-2.js" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "manual-migrate-3.js" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "manual-migrate-4.js" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "manual-migrate-foundation.js" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "manual-migrate.js" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "migrations.zip" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "scripts\DELIVERY_MANIFEST.md" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "src\db\schema\index.ts.phase-07.patch" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "src\routes\portal.ts.phase-07.patch" -Force -ErrorAction SilentlyContinue
```
> مجلدات ممكن تفضل فاضية بعد المسح: `.`، `e2e`، `scripts`، `src/db/schema`، `src/routes` — امسحها لو فاضية.

## ٣) الحزم والبيئة
- `package.json` اتغيّر: نفّذ `npm ci --include=dev`.
- راجع `.env.example` لو فيه متغير جديد وضيفه في Vercel/`.env`.

## ٤) الهجرات والتحقق
```bash
npm ci --include=dev
npm run db:migrate
npm run check:all
npm run check:e2e
node scripts/delivery-pack.mjs verify --dir <مسار-مجلد-الحزمة-المفكوكة> --root .
```

## ٥) الرجوع (Rollback)
- الكود: ارجع للنسخة السابقة من ملفات الحزمة (git checkout أو النسخة الاحتياطية للمجلد)، وأعد النشر.
- هجرة `migrations/0077_hardening_audit_idempotency.sql`:
```sql
  DROP TRIGGER IF EXISTS audit_events_no_update_delete ON audit_events;
  DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
  DROP FUNCTION IF EXISTS audit_events_block_mutation();
  DROP INDEX IF EXISTS command_idempotency_created_at_idx;
```
- لو الهجرة اتنفذت وفيها بيانات: استرجع من النسخة الاحتياطية اللي أخدتها قبل التنفيذ.
