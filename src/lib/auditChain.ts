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

/**
 * تفرّعات السلسلة القديمة: قبل إضافة القفل الاستشاري على writeAuditEvent كانت كتابتين متزامنتين بتقروا نفس «آخر hash»
 * وبتكتبوا صفين بنفس prev_hash (ده سبب «السجل #289»). القفل (والإصلاح التاني: الكتابة من غير معاملة كانت من غير حماية) اتركّبوا قبل الحد ده، فأي تفرّع بعده = تكرار
 * للمشكلة أو تلاعب، ولازم يفضل أحمر. التفرّع المقبول ليه توقيع محدد (شرحه في verifyAuditBatch).
 */
export const AUDIT_FORK_TOLERATED_BEFORE = new Date("2026-11-07T00:00:00Z");
// الكتابة المتأخرة القديمة (قبل القفل) كانت ممكن تكتب بعد آخر سجل بدقيقة أو أكتر وتفضل ماسكة hash أقدم (حالة #412: بعد 29 ثانية ومربوطة بسجل قبل اتنين).
const FORK_WINDOW_MS = 10 * 60_000;
const RECENT_HASHES = 10;

export type VerifyOptions = {
  /** لو اتحددت: تفرّع «كتابة متزامنة» قبل التاريخ ده بيتقبل ويتسجّل في forks بدل ما يكسر الفحص. من غيرها الفحص صارم. */
  forkToleratedBefore?: Date;
};

export type ChainState = {
  /** hash آخر ١٠ صفوف مقبولة (الأحدث في الآخر): الصف المتفرّع القديم بيكون مربوط بواحد منهم مش بالأحدث. */
  recent: string[];
  /** وقت إنشاء الصف الأخير المقبول (ms). */
  lastCreatedAtMs: number | null;
  /** أرقام الصفوف المتفرّعة المقبولة (كتابة متزامنة قديمة). */
  forks: number[];
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
  recent: [],
  lastCreatedAtMs: null,
  forks: [],
  prevHash: null,
  checked: 0,
  legacyUnsealed: 0,
  sealedStarted: false,
});

/** يفحص دفعة صفوف مرتبة بالـid ويكمل من state السابق. لا يعدّل state المُمرَّر (يرجّع نسخة). */
export function verifyAuditBatch(
  state: ChainState,
  rows: ReadonlyArray<AuditHashRow>,
  opts: VerifyOptions = {},
): { state: ChainState; verdict: ChainVerdict } {
  const next: ChainState = { ...state, forks: [...state.forks], recent: [...state.recent] };
  for (const row of rows) {
    if (row.recordHash === "") {
      if (next.sealedStarted) {
        return { state: next, verdict: { valid: false, firstInvalidId: row.id, reason: "unsealed_after_sealed" } };
      }
      next.legacyUnsealed += 1;
      continue;
    }
    next.sealedStarted = true;
    const tolerant = !!opts.forkToleratedBefore && row.createdAt.getTime() < opts.forkToleratedBefore.getTime();
    const ownHashOk = row.recordHash === computeAuditRecordHash(row.prevHash, row);
    const nearLast = next.lastCreatedAtMs !== null && Math.abs(row.createdAt.getTime() - next.lastCreatedAtMs) <= FORK_WINDOW_MS;
    if (row.prevHash === next.prevHash) {
      if (!ownHashOk) {
        return { state: next, verdict: { valid: false, firstInvalidId: row.id, reason: "hash_mismatch" } };
      }
    } else if (tolerant && next.checked > 0 && row.prevHash !== null && next.recent.includes(row.prevHash)) {
      // تفرّع قديم (كتابة متزامنة قبل القفل): السجل مربوط بسجل من آخر ١٠ سجلات مقبولة مش بالأحدث، وفي نفس الفترة.
      // حذف صف أو تلاعب بيدّي توقيع مختلف (prev بيشاور على صف مش موجود)، وتعديل المحتوى بيكسر البصمة، فالاتنين بيفضلوا أحمر.
      if (!ownHashOk || !nearLast) {
        return { state: next, verdict: { valid: false, firstInvalidId: row.id, reason: ownHashOk ? "prev_mismatch" : "hash_mismatch" } };
      }
      next.forks.push(row.id);
    } else {
      return { state: next, verdict: { valid: false, firstInvalidId: row.id, reason: "prev_mismatch" } };
    }
    next.recent.push(row.recordHash);
    if (next.recent.length > RECENT_HASHES) next.recent.shift();
    next.lastCreatedAtMs = row.createdAt.getTime();
    next.prevHash = row.recordHash;
    next.checked += 1;
  }
  return { state: next, verdict: { valid: true } };
}
