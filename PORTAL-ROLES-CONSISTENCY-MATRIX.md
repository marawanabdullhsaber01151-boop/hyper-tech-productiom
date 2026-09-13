# Portal Roles Consistency Matrix

تاريخ الفحص: 2026-09-11

المصدر المعتمد للصلاحيات هو `src/lib/permissions.ts`. يتم التحقق من قوائم
الواجهة (`data-allowed-roles`) وقائمة التنقل في `src/lib/departments.ts` ضد
نفس المصفوفة تلقائيًا بواسطة:

```bash
npm run check:roles
```

| الصفحة | الأدوار في الفرونت إند | الأدوار في الـ nav | الأدوار في الباك إند | النتيجة |
|---|---|---|---|---|
| `portal.html` | عام / عميل بوابة، بدون `data-allowed-roles` | غير موجود | جلسة عميل البوابة العامة | ✅ متسق |
| `portal-login.html` | عام / عميل بوابة، بدون `data-allowed-roles` | غير موجود | مصادقة عميل البوابة العامة | ✅ متسق |
| `portal-orders.html` | `chairman`, `executive_manager`, `sales_manager`, `online_seller`, `offline_seller`, `hr`, `hr_manager` | نفس القائمة | نفس القائمة من `PERMISSIONS.sales.write` في `portal-orders.ts` | ✅ متسق |
| `portal-customers-admin.html` | `chairman`, `executive_manager`, `sales_manager` | نفس القائمة | نفس القائمة من `PERMISSIONS.portalCustomers.write` في `portal-customers-admin.ts` | ✅ متسق |
| `portal-applications-admin.html` | `chairman`, `executive_manager`, `sales_manager` | نفس القائمة | نفس القائمة من `PERMISSIONS.portalCustomers.write` في `portal-customers-admin.ts` | ✅ متسق |
| `portal-activation-requests-admin.html` | `chairman`, `executive_manager`, `sales_manager` | نفس القائمة | نفس القائمة من `PERMISSIONS.portalCustomers.write` في `portal-customers-admin.ts` | ✅ متسق |

## ملاحظات المطابقة

- صفحات `portal.html` و`portal-login.html` عامة ومخصصة لعميل البوابة، لذلك لا
  تحمل أدوار موظفين ولا تظهر في تنقل الموظفين. الحماية الخاصة بها هي
  `requirePortalAuth` عند الحاجة، وليست `requireRole` الخاصة بموظفي النظام.
- صفحة `portal-orders.html` تستخدم نفس قائمة `PERMISSIONS.sales.write` في
  مسارات العرض والتأكيد والرفض.
- صفحات إدارة البوابة الثلاث تستخدم قائمة
  `PERMISSIONS.portalCustomers.write`؛ وهي حاليًا مطابقة تمامًا لقائمة
  `portalCustomers.view`، لكن ربطها بـ`write` يعكس أن الصفحات تحتوي عمليات
  إدارة وتعديل، وليس عرضًا فقط.
- لم يتم تعديل قوائم الأدوار لأنها كانت متسقة بالفعل في النسخة المفحوصة؛ تمت
  إضافة فحص آلي يمنع عودة التعارض مستقبلًا.