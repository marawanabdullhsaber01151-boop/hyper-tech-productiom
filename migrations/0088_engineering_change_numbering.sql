-- 0088 — ترقيم طلبات التغيير الهندسي بتسلسل حقيقي + سبب القرار — الخطوة 33أ
--
-- كان رقم الطلب بيتولّد من الوقت (ECR-<ملّي ثانية>): مش متسلسل ومش بيتقري. دلوقتي بيتولّد من
-- phase0_number_sequences جوّه نفس معاملة الإدخال (زي باقي المستندات). الأرقام القديمة ما بتتغيّرش.
-- وإضافة عمود decision_reason لتسجيل سبب اعتماد/رفض الطلب (القرار نفسه جديد في الخطوة دي).
--
-- Rollback:
--   ALTER TABLE engineering_change_requests DROP COLUMN IF EXISTS decision_reason;
--   DELETE FROM phase0_number_sequences WHERE sequence_key = 'engineering_change_request';

INSERT INTO "phase0_number_sequences" ("sequence_key", "prefix", "next_value", "padding")
VALUES ('engineering_change_request', 'ECR-', 1, 6)
ON CONFLICT ("sequence_key") DO NOTHING;

ALTER TABLE "engineering_change_requests" ADD COLUMN IF NOT EXISTS "decision_reason" text;
