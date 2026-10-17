/** @format */
/**
 * التحقق من سلسلة التدقيق (hash chain) على دفعات.
 *
 * ليه: النسخة القديمة كانت بتسحب جدول audit_events كله في الذاكرة، والجدول بيكبر مع كل
 * عملية كتابة في النظام (mutationAudit بيسجّل كل POST/PUT/PATCH/DELETE). والصفوف اللي اتسجّلت قبل
 * هجرة 0016 عندها record_hash فاضي فكانت بتطلّع «السلسلة مكسورة» غلط من أول صف.
 *
 * نفس معادلة الـhash المستخدمة في writeAuditEvent بالظبط (لازم تفضل متطابقة).
 */
import { createHash } from "node:crypto";

export type AuditHashRow = {
  id: number;
  actorUserId: number | null;
  actionKey: string;
  resourceId: number | null;
  createdAt: Date;
  prevHash: string | null;
  recordHash: string;
};

export function computeAuditRecordHash(
  prevHash: string | null,
  row: Pick<AuditHashRow, "actorUserId" | "actionKey" | "resourceId" | "createdAt">,
): string {
  return createHash("sha256")
    .update(
      [
        prevHash ?? "",
        row.actorUserId ?? "",
        row.actionKey,
        row.resourceId ?? "",
        row.createdAt.toISOString(),
      ].join(""),
    )
    .digest("hex");
}

export type ChainState = {
  /** آخر hash مؤكَّد (null = لسه ما بدأناش أو أول صف موقّع) */
  prevHash: string | null;
  /** عدد الصفوف الموقّعة اللي اتفحصت */
  checked: number;
  /** صفوف قديمة (قبل هجرة 0016) بدون hash — بتتخطى */
  legacyUnsealed: number;
  /** هل شفنا صف موقّع؟ بعدها أي صف بدون hash = مخالفة */
  sealedStarted: boolean;
};

export type ChainVerdict =
  | { valid: true }
  | { valid: false; firstInvalidId: number; reason: "prev_mismatch" | "hash_mismatch" | "unsealed_after_sealed" };

export const emptyChainState = (): ChainState => ({
  prevHash: null,
  checked: 0,
  legacyUnsealed: 0,
  sealedStarted: false,
});

/** يفحص دفعة صفوف مرتبة بالـid ويكمل من state السابق. لا يعدّل state المُمرَّر (يرجّع نسخة). */
export function verifyAuditBatch(
  state: ChainState,
  rows: ReadonlyArray<AuditHashRow>,
): { state: ChainState; verdict: ChainVerdict } {
  const next: ChainState = { ...state };
  for (const row of rows) {
    if (row.recordHash === "") {
      if (next.sealedStarted) {
        return { state: next, verdict: { valid: false, firstInvalidId: row.id, reason: "unsealed_after_sealed" } };
      }
      next.legacyUnsealed += 1;
      continue;
    }
    next.sealedStarted = true;
    if (row.prevHash !== next.prevHash) {
      return { state: next, verdict: { valid: false, firstInvalidId: row.id, reason: "prev_mismatch" } };
    }
    if (row.recordHash !== computeAuditRecordHash(next.prevHash, row)) {
      return { state: next, verdict: { valid: false, firstInvalidId: row.id, reason: "hash_mismatch" } };
    }
    next.prevHash = row.recordHash;
    next.checked += 1;
  }
  return { state: next, verdict: { valid: true } };
}
