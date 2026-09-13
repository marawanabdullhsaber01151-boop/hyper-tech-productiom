-- تقوية دورة الإنتاج: فهارس تساعد قفل الأوامر وسجل التدقيق.
-- لا تغيّر بنية البيانات ولا تعتمد على سكربت يدوي، وآمنة عند تكرار التشغيل.

CREATE INDEX IF NOT EXISTS production_workflow_orders_status_id_idx
  ON production_workflow_orders (workflow_status, id);

CREATE INDEX IF NOT EXISTS audit_events_production_workflow_idx
  ON audit_events (resource_type, resource_id, created_at DESC);

COMMENT ON INDEX production_workflow_orders_status_id_idx IS
  'يساعد تحديثات الانتقال المحمية بشرط الحالة داخل معاملات دورة الإنتاج';

COMMENT ON INDEX audit_events_production_workflow_idx IS
  'فهرس سجل انتقالات أوامر الإنتاج للعرض الزمني والتدقيق';