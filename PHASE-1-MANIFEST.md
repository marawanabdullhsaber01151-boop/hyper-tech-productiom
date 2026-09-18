# Phase 1 — Portal Catalog Sourced From Foundation Items — Delivery Manifest

### New files
- migrations/0057_phase1_portal_catalog_foundation_link.sql
- src/lib/portalCatalog.ts
- src/lib/portalCatalog.test.ts

### Modified files
- src/db/schema/bom.ts
- src/routes/bom.ts
- src/routes/foundation.ts
- src/routes/portal.ts
- public/bom.html
- public/JS/bom.js
- public/CSS/bom.css

### Verification performed
- `npx tsc --noEmit` — 0 errors
- `npx vitest run` — 28 test files, 166 tests passed, 0 failed, 3 pre-existing skips
- New test file `src/lib/portalCatalog.test.ts` covers Foundation-preferred vs.
  legacy-fallback product identity resolution directly.
- Manual trace of: create-recipe validation (must pick a Foundation
  finished-good item), edit-recipe re-sync when a new Foundation item is
  picked, and the "don't wipe an existing link" guard when the linked
  Foundation item is missing from the dropdown (e.g. became inactive).

### Notes for whoever applies this to the running database
Run migration `0057_phase1_portal_catalog_foundation_link.sql` via the
project's normal `npm run db:migrate` before deploying the updated code —
it is additive and safe to run on the live database at any time.

---

## ✅ ملاحظات التوفيق مع أحدث نسخة من المشروع (hyper-tech-production-main)

اتراجعت الملفات دي كلها على أحدث نسخة من المشروع قبل التسليم، والتعديلات
الآتية اتعملت عشان التركيب يعدّي من غير أي تعارض ومن غير ما يتشال أي كود
موجود حاليًا:

- **ترقيم الترحيل (migration) اتغيّر:** المشروع الحالي عنده بالفعل
  `0055_phase2_canonical_production_domain.sql` و`0056_phase2_lifecycle_controls.sql`.
  ولأن `scripts/run-migrations.mjs` و`scripts/repository-self-check.mjs`
  بيرفضوا أي تكرار في رقم الترحيل، الملف اترقّم من `0055` إلى **`0057`**
  (نفس المحتوى بالظبط، إضافي وidempotent).

**ترتيب التركيب الإجباري:** المرحلة 1 ← 2 ← 3 ← 4 ← 5 ← 6 ← 7.
الملفات تراكمية (الملف في المرحلة الأحدث بيحتوي على تعديلات المراحل اللي
قبلها لنفس الملف)، فلازم تتركب بالترتيب ده.

**مفيش أي ملف أو سطر من المشروع الحالي اتحذف** — الملفات اللي بتتبدّل هنا
نسخة أحدث بتحتوي على كل اللي كان فيها + الإضافات الجديدة.
