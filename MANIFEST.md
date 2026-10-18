# MANIFEST — hardening-2

- الأساس: `dir:base2`
- التاريخ: 2026-10-18
- الإجمالي: 5 جديد، 13 معدّل، 0 محذوف

## ١) ملفات جديدة (A)
| الملف | النوع | الحجم | sha256 | ملاحظة |
|---|---|---|---|---|
| `docs/reports/hardening-2.md` | جديد | 6.1 KB | `71192dc55f79` |  |
| `migrations/0078_portal_customer_archive.sql` | جديد | 1.2 KB | `54298d607e8e` |  |
| `src/hardening-2.regression.test.ts` | جديد | 5.0 KB | `ded44ef27ac8` |  |
| `src/lib/companyArchive.test.ts` | جديد | 2.9 KB | `a821cc4cb52f` |  |
| `src/lib/companyArchive.ts` | جديد | 3.0 KB | `db4d90fb2e31` |  |

## ٢) ملفات معدّلة (M) — الملف كامل يستبدل القديم
| الملف | النوع | الحجم | sha256 | ملاحظة |
|---|---|---|---|---|
| `COMMANDS.md` | معدّل | 1.5 KB | `3bee305c0ffd` |  |
| `docs/KNOWN_ISSUES.md` | معدّل | 2.6 KB | `389b92f589fc` |  |
| `docs/PROJECT_STATUS.md` | معدّل | 1.8 KB | `0ac4ebf5248e` |  |
| `src/db/schema/portal-customers.ts` | معدّل | 6.1 KB | `84d5ad10c2bb` |  |
| `src/lib/portalCompaniesQuery.ts` | معدّل | 7.0 KB | `592a1efd4e41` |  |
| `src/routes/portal-companies-list.ts` | معدّل | 35.9 KB | `d91a52dec260` |  |
| `src/routes/portal-customers-admin.ts` | معدّل | 55.8 KB | `a282ac236400` |  |
| `src/routes/settings.ts` | معدّل | 22.8 KB | `f5c3a6a3b93d` |  |
| `web/src/admin/parts.tsx` | معدّل | 2.4 KB | `cedf7867bee0` |  |
| `web/src/admin/screens/Companies.tsx` | معدّل | 15.3 KB | `410baf81aff5` |  |
| `web/src/admin/screens/CompanyTabs.tsx` | معدّل | 22.6 KB | `aaeaa0cf502e` |  |
| `web/src/admin/types.ts` | معدّل | 10.0 KB | `e1570a7ec064` |  |
| `web/src/copy/admin.ts` | معدّل | 32.6 KB | `28758b8d25e4` |  |

## ٣) نقل/إعادة تسمية (R)
_الأداة تعامل النقل كحذف + إضافة؛ شوف §١ و§٤._

## ٤) ملفات محذوفة (D) — أوامر المسح في COMMANDS.md §٢
_لا يوجد_

## ٥) هجرات قاعدة البيانات
- `migrations/0078_portal_customer_archive.sql`

## ٦) متغيرات بيئة
_لا يوجد تغيير في .env.example_
