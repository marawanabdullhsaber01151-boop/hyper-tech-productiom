# MANIFEST — hardening-1

- الأساس: `dir:hyper-tech-productiom-main`
- التاريخ: 2026-10-17
- الإجمالي: 17 جديد، 19 معدّل، 40 محذوف

## ١) ملفات جديدة (A)
| الملف | النوع | الحجم | sha256 | ملاحظة |
|---|---|---|---|---|
| `docs/archive/KNOWN_ISSUES-pre-hardening-1.md` | جديد | 0.9 KB | `1b6207e5870b` |  |
| `docs/archive/PROJECT_STATUS-pre-hardening-1.md` | جديد | 13.8 KB | `bc3791c26350` |  |
| `docs/reports/hardening-1.md` | جديد | 13.3 KB | `faf006df2694` |  |
| `migrations/0077_hardening_audit_idempotency.sql` | جديد | 3.1 KB | `b2de171c96e1` |  |
| `scripts/delivery-pack.mjs` | جديد | 18.9 KB | `aa2979bb4690` |  |
| `src/hardening-1.regression.test.ts` | جديد | 5.6 KB | `ee088f10f369` |  |
| `src/lib/afterCommit.test.ts` | جديد | 1.4 KB | `9516519113cc` |  |
| `src/lib/afterCommit.ts` | جديد | 2.1 KB | `50412100fa88` |  |
| `src/lib/auditChain.test.ts` | جديد | 4.3 KB | `62a535f90c83` |  |
| `src/lib/auditChain.ts` | جديد | 3.1 KB | `77b8a95e238d` |  |
| `src/lib/commandRetention.ts` | جديد | 0.9 KB | `bc31d624e003` |  |
| `src/lib/money.test.ts` | جديد | 2.9 KB | `d8c7526f52a6` |  |
| `src/lib/money.ts` | جديد | 4.0 KB | `ea34207d01ca` |  |
| `src/lib/sessionTouch.test.ts` | جديد | 1.1 KB | `e482cde8be2e` |  |
| `src/lib/sessionTouch.ts` | جديد | 0.9 KB | `2bf985234abb` |  |
| `src/lib/trustProxy.test.ts` | جديد | 1.0 KB | `59c7345f75d4` |  |
| `src/lib/trustProxy.ts` | جديد | 1.4 KB | `7e823184c630` |  |

## ٢) ملفات معدّلة (M) — الملف كامل يستبدل القديم
| الملف | النوع | الحجم | sha256 | ملاحظة |
|---|---|---|---|---|
| `.env.example` | معدّل | 5.7 KB | `a82f2856606b` |  |
| `.github/workflows/ci.yml` | معدّل | 1.3 KB | `5f514ed8969f` |  |
| `.gitignore` | معدّل | 0.3 KB | `5a2a1c256767` |  |
| `COMMANDS.md` | معدّل | 6.7 KB | `a931baecfd6e` |  |
| `README.md` | معدّل | 2.4 KB | `920d05f517b8` |  |
| `docs/KNOWN_ISSUES.md` | معدّل | 2.7 KB | `f2c24a752f93` |  |
| `docs/PROJECT_STATUS.md` | معدّل | 1.5 KB | `0ea4e6a1a0d1` |  |
| `package.json` | معدّل | 3.8 KB | `4afc66441845` |  |
| `scripts/reset-test-data.mjs` | معدّل | 6.3 KB | `c0411874afc4` |  |
| `scripts/wipe-customers.mjs` | معدّل | 15.4 KB | `f0c3412200f4` |  |
| `src/db/schema/portal-order-reviews.ts` | معدّل | 2.9 KB | `440a4c9e6395` |  |
| `src/main.ts` | معدّل | 8.4 KB | `b6ca8beaca2e` |  |
| `src/middleware/auth.ts` | معدّل | 12.2 KB | `e8285a3ce658` |  |
| `src/routes/chat-staff.ts` | معدّل | 34.6 KB | `eabbea3815dd` |  |
| `src/routes/governance.ts` | معدّل | 20.5 KB | `b2e931474ec3` |  |
| `src/routes/health.ts` | معدّل | 6.8 KB | `c046604f68e3` |  |
| `src/routes/portal-orders.ts` | معدّل | 33.1 KB | `1111245a76ec` |  |
| `src/routes/portal.ts` | معدّل | 120.2 KB | `6c5e90a7e8f9` |  |
| `web/src/portal/screens/Products.tsx` | معدّل | 8.7 KB | `8ae6949cb45d` |  |

## ٣) نقل/إعادة تسمية (R)
_الأداة تعامل النقل كحذف + إضافة؛ شوف §١ و§٤._

## ٤) ملفات محذوفة (D) — أوامر المسح في COMMANDS.md §٢
- `CHANGE-MANIFEST-PHASE-00.md`
- `CHANGE-MANIFEST-PHASE-1.md`
- `CHANGE-MANIFEST-PHASE-2-PART-1.md`
- `CHANGE-MANIFEST-PHASE-2-PART-2.md`
- `CHANGE-MANIFEST-PHASE-2.md`
- `CHANGE-MANIFEST-PHASE-3-PART-1.md`
- `CHANGE-MANIFEST-PHASE-3-PART-2.md`
- `CHANGE-MANIFEST-PHASE-3-PART-3.md`
- `CHANGE-MANIFEST-PHASE-3.md`
- `CHANGE-MANIFEST-PHASE-4.md`
- `CHANGE-MANIFEST-PHASE-5.md`
- `CHANGE-MANIFEST-SECURITY-HARDENING.md`
- `DELIVERY_MANIFEST.md`
- `FILES_DELIVERED.txt`
- `HYPER-TECH-FIXES-REPORT.md`
- `MANIFEST.txt`
- `PHASE-1-AFFECTED-FILES.md`
- `PHASE-1-MANIFEST.md`
- `PORTAL-ORDERS-FIX-REPORT.md`
- `PORTAL-ROLES-CONSISTENCY-MATRIX.md`
- `README-#U0643#U064a#U0641#U064a#U0629-#U0627#U0644#U062a#U0631#U0643#U064a#U0628.md`
- `SALES-STATUS-TRANSITION-MATRIX.md`
- `STAGE-03-MANIFEST.md`
- `STAGE_00_03_DELIVERY_MANIFEST.md`
- `STAGE_FILES_MANIFEST.md`
- `add-missing-columns.sql`
- `create-portal-customers-table.sql`
- `diagnose-login.mjs`
- `e2e/approval-flow.e2e.test.ts`
- `hyper_erp_backup_2026-08-22.json`
- `list-users.mjs`
- `manual-migrate-2.js`
- `manual-migrate-3.js`
- `manual-migrate-4.js`
- `manual-migrate-foundation.js`
- `manual-migrate.js`
- `migrations.zip`
- `scripts/DELIVERY_MANIFEST.md`
- `src/db/schema/index.ts.phase-07.patch`
- `src/routes/portal.ts.phase-07.patch`

## ٥) هجرات قاعدة البيانات
- `migrations/0077_hardening_audit_idempotency.sql`

## ٦) متغيرات بيئة
- `.env.example` اتعدّل — راجع المتغيرات الجديدة وضيفها في Vercel.
