-- إصلاح أداء: /governance/audit بيعمل ORDER BY created_at DESC LIMIT بدون أي
-- فلتر، لكن الفهارس الموجودة على audit_events (resource_type+resource_id،
-- actor_user_id+created_at) ما تفدش الاستعلام ده خالص، فبيضطر لعمل full scan
-- + sort مع كل نداء — وده بيتكرر تلقائيًا بعد كل إجراء واحد في شاشة الحوكمة
-- (governance.js بيعيد تحميل 8 نقاط بيانات مع بعض بعد أي تعديل واحد).
-- آمن يتكرر تشغيله، ومش بيغيّر أي بيانات.

CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
  ON audit_events (created_at DESC);

COMMENT ON INDEX audit_events_created_at_idx IS
  'يخدم استعلام GET /governance/audit (ORDER BY created_at DESC LIMIT) اللي بيتكرر مع كل تحديث في شاشة الحوكمة';
