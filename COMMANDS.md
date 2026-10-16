# أوامر المرحلة ٠

١) انسخ الملفات فوق المشروع (نفس المسارات).

٢) امسح الملفات القديمة دي (الأسطر دي أوامر جاهزة):

```bash
rm -f "add-missing-columns.sql"
rm -f "create-portal-customers-table.sql"
rm -f "diagnose-login.mjs"
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
rm -f "README-#U0643#U064a#U0641#U064a#U0629-#U0627#U0644#U062a#U0631#U0643#U064a#U0628.md"
rm -f "STAGE-03-MANIFEST.md"
rm -f "STAGE_00_03_DELIVERY_MANIFEST.md"
rm -f "STAGE_FILES_MANIFEST.md"
rm -f "scripts/DELIVERY_MANIFEST.md"
rm -f "PORTAL-ROLES-CONSISTENCY-MATRIX.md"
rm -f "SALES-STATUS-TRANSITION-MATRIX.md"
rm -f "e2e/approval-flow.e2e.test.ts"
rm -f "hyper_erp_backup_2026-08-22.json"
rm -f "list-users.mjs"
rm -f "manual-migrate-2.js"
rm -f "manual-migrate-3.js"
rm -f "manual-migrate-4.js"
rm -f "manual-migrate-foundation.js"
rm -f "manual-migrate.js"
rm -f "migrations.zip"
rm -f "src/db/schema/index.ts.phase-07.patch"
rm -f "src/routes/portal.ts.phase-07.patch"
```

٣) تحقق:

```bash
npm ci
npm run db:migrate   # لازم قاعدة الاختبار تمر بكل الهجرات
npx tsc --noEmit -p . && npx tsc --noEmit -p web
npm test && npm run test:web && npm run build
npm run test:e2e
```

٤) خلي المستودع خاص، وفكّر تمسح ملف النسخة الاحتياطية القديم من تاريخ git (فيه بيانات عملاء).
