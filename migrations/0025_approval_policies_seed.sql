-- ✅ زرع سياسات الاعتماد الفعلية (approval_policies) لأول مرة.
-- البنية والمنطق كانا موجودين بالفعل وشغالين في sales.ts / purchases.ts /
-- accounting.ts / operations.ts، لكن الجدول كان فاضيًا بالكامل، فمكانش
-- في أي سقف فعلي بيوقف أو يصعّد أي عملية لأي مستوى أعلى.
--
-- المنطق: لكل action_key، أول صف (sequence 1) هو اعتماد المستوى التنفيذي
-- المباشر لحد سقف معيّن. أي مبلغ أكبر من أعلى سقف مُعرّف يقع تلقائيًا
-- تحت صف sequence أعلى (chairman/executive_manager) بدون أي حد أقصى.
--
-- الأرقام أدناه قابلة للتعديل لاحقًا في أي وقت من واجهة "سياسات الاعتماد"
-- في governance.html (متاحة لـ chairman فقط) — مفيش داعي لتعديل هذا
-- الملف مرة تانية لتغيير رقم.

-- ⚠️ ملحوظة تقنية: جدول approval_policies (في 0003_governance.sql) معرّف
-- بـ index عادي بس (approval_policies_lookup_idx)، من غير أي UNIQUE
-- constraint حقيقي. يعني "ON CONFLICT DO NOTHING" كانت هتفشل فعليًا وقت
-- التشغيل برسالة "there is no unique or exclusion constraint matching
-- the ON CONFLICT specification". استبدلتها بمنطق INSERT ... SELECT ...
-- WHERE NOT EXISTS، وده بيدي نفس نتيجة عدم التكرار (idempotent) لو
-- الملف اتشغّل أكتر من مرة بالغلط، من غير الاعتماد على أي constraint.

INSERT INTO "approval_policies"
  ("action_key", "min_amount", "approver_roles", "sequence", "required_approvals", "active")
SELECT * FROM (VALUES
  -- ── المبيعات: اعتماد أمر بيع ──
  -- حتى 100,000 جنيه: مدير المبيعات يعتمد بنفسه
  ('sales.approve', 0::numeric, '["sales_manager"]'::jsonb, 1, 1, true),
  -- أكتر من 100,000: يتصعّد تلقائيًا للإدارة التنفيذية / رئيس مجلس الإدارة
  ('sales.approve', 100000::numeric, '["executive_manager","chairman"]'::jsonb, 2, 1, true),

  -- ── المشتريات: اعتماد أمر شراء ──
  -- حتى 150,000 جنيه: مدير المشتريات يعتمد بنفسه
  ('purchases.approve', 0::numeric, '["purchasing_manager"]'::jsonb, 1, 1, true),
  -- أكتر من 150,000: يتصعّد للإدارة التنفيذية / رئيس مجلس الإدارة
  ('purchases.approve', 150000::numeric, '["executive_manager","chairman"]'::jsonb, 2, 1, true),

  -- ── المحاسبة: قيود مالية (accounting.create) ──
  -- حتى 50,000 جنيه: قسم الموارد البشرية/المحاسبة (hr_manager) يعتمد بنفسه
  ('accounting.create', 0::numeric, '["hr_manager"]'::jsonb, 1, 1, true),
  -- أكتر من 50,000: رئيس مجلس الإدارة فقط
  ('accounting.create', 50000::numeric, '["chairman"]'::jsonb, 2, 1, true),

  -- ── تكلفة الإنتاج (productionWorkflow.cost.record) ──
  -- حتى 75,000 جنيه: مدير الإنتاج يعتمد بنفسه
  ('productionWorkflow.cost.record', 0::numeric, '["production_manager"]'::jsonb, 1, 1, true),
  -- أكتر من 75,000: يتصعّد لمدير التشغيل ثم الإدارة التنفيذية
  ('productionWorkflow.cost.record', 75000::numeric, '["operations_manager","executive_manager","chairman"]'::jsonb, 2, 1, true)
) AS new_policy(action_key, min_amount, approver_roles, sequence, required_approvals, active)
WHERE NOT EXISTS (
  SELECT 1 FROM "approval_policies" ap
  WHERE ap.action_key = new_policy.action_key
    AND ap.min_amount = new_policy.min_amount
    AND ap.sequence = new_policy.sequence
);
