-- استعادة كل بيانات الإعداد الأساسية اللي بتتزرع تلقائيًا وقت أول تشغيل
-- للنظام، واللي سكريبت "مسح بيانات الاختبار" كان بيمسحها غلط لأنها ماكنتش
-- محمية. آمن تمامًا تشغّله أكتر من مرة (كل سطر بيتأكد إن الصف مش موجود
-- قبل ما يضيفه).

-- 1) عدادات ترقيم المستندات — ده اللي كان بيوقف إرسال الطلب.
INSERT INTO "phase0_number_sequences" ("sequence_key", "prefix", "next_value", "padding")
VALUES
  ('production_order', 'PO-', 1, 6),
  ('production_batch', 'B-', 1, 6),
  ('production_operation', 'OP-', 1, 6),
  ('production_ncr', 'NCR-', 1, 6),
  ('production_plan', 'PLAN-', 1, 6),
  ('purchase_requisition', 'PR-', 1, 6),
  ('operations_case', 'OC-', 1, 6)
ON CONFLICT ("sequence_key") DO NOTHING;

-- 2) قواعد الانتقال بين الحالات (أداة الاختبار في صفحة البيانات الأساسية)
INSERT INTO "foundation_state_transitions"
  ("entity_type", "from_state", "to_state", "required_role", "requires_reason")
VALUES
  ('production_order', 'new', 'pending_supervisor', 'production_manager', false),
  ('production_order', 'pending_supervisor', 'materials_requested', 'supervisor', false),
  ('production_order', 'materials_requested', 'materials_approved', 'warehouse_manager', false),
  ('production_order', 'materials_requested', 'materials_partial', 'warehouse_manager', true),
  ('production_order', 'materials_requested', 'materials_rejected', 'warehouse_manager', true),
  ('production_order', 'materials_approved', 'in_production', 'supervisor', false),
  ('production_order', 'in_production', 'quality_check', 'quality_controller', false),
  ('production_order', 'quality_check', 'completed', 'quality_controller', false),
  ('production_order', 'completed', 'delivered_customer', 'production_manager', false),
  ('production_order', 'completed', 'delivered_warehouse', 'production_manager', false),
  ('production_order', 'new', 'cancelled', 'manager', true),
  ('production_order', 'pending_supervisor', 'cancelled', 'manager', true)
ON CONFLICT ("entity_type", "from_state", "to_state", "required_role") DO NOTHING;

-- 3) قواعد فصل المهام (مين يقدر يعتمد حاجة هو نفسه أنشأها) — الثلاث صفوف
-- كاملة من migrations/0011_sod_rules.sql
INSERT INTO sod_rules (action_key_create, action_key_approve)
SELECT 'purchases.create', 'purchases.approve'
WHERE NOT EXISTS (
  SELECT 1 FROM sod_rules
  WHERE action_key_create = 'purchases.create' AND action_key_approve = 'purchases.approve'
);
INSERT INTO sod_rules (action_key_create, action_key_approve)
SELECT 'accounting.create', 'accounting.approve'
WHERE NOT EXISTS (
  SELECT 1 FROM sod_rules
  WHERE action_key_create = 'accounting.create' AND action_key_approve = 'accounting.approve'
);
INSERT INTO sod_rules (action_key_create, action_key_approve)
SELECT 'sales.create', 'sales.approve'
WHERE NOT EXISTS (
  SELECT 1 FROM sod_rules
  WHERE action_key_create = 'sales.create' AND action_key_approve = 'sales.approve'
);

-- 4) سياسات اعتماد المبيعات/المشتريات/المحاسبة/تكلفة الإنتاج حسب المبلغ
-- (نُسخت بالكامل وبالظبط من migrations/0025_approval_policies_seed.sql —
-- النسخة اللي كانت هنا قبل كده كانت ناقصة صفوف المشتريات والمحاسبة
-- وتكلفة الإنتاج، اتصلّحت.)
INSERT INTO "approval_policies"
  ("action_key", "min_amount", "approver_roles", "sequence", "required_approvals", "active")
SELECT * FROM (VALUES
  ('sales.approve', 0::numeric, '["sales_manager"]'::jsonb, 1, 1, true),
  ('sales.approve', 100000::numeric, '["executive_manager","chairman"]'::jsonb, 2, 1, true),
  ('purchases.approve', 0::numeric, '["purchasing_manager"]'::jsonb, 1, 1, true),
  ('purchases.approve', 150000::numeric, '["executive_manager","chairman"]'::jsonb, 2, 1, true),
  ('accounting.create', 0::numeric, '["hr_manager"]'::jsonb, 1, 1, true),
  ('accounting.create', 50000::numeric, '["chairman"]'::jsonb, 2, 1, true),
  ('productionWorkflow.cost.record', 0::numeric, '["production_manager"]'::jsonb, 1, 1, true),
  ('productionWorkflow.cost.record', 75000::numeric, '["operations_manager","executive_manager","chairman"]'::jsonb, 2, 1, true)
) AS new_policy(action_key, min_amount, approver_roles, sequence, required_approvals, active)
WHERE NOT EXISTS (
  SELECT 1 FROM "approval_policies" ap
  WHERE ap.action_key = new_policy.action_key
    AND ap.min_amount = new_policy.min_amount
    AND ap.sequence = new_policy.sequence
);

-- 5) قاعدة توصيل افتراضية
INSERT INTO delivery_method_rules (label, timing, delivery_method, priority)
SELECT 'افتراضي — استلام من المخزن', 'any', 'warehouse', 1000
WHERE NOT EXISTS (SELECT 1 FROM delivery_method_rules);
