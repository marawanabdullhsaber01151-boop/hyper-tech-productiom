/** @format */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AuditHashRow,
  computeAuditRecordHash,
  emptyChainState,
  verifyAuditBatch,
} from "./auditChain";

function chain(n: number, startId = 1, legacy = 0): AuditHashRow[] {
  const rows: AuditHashRow[] = [];
  let prev: string | null = null;
  for (let i = 0; i < legacy; i++) {
    rows.push({ id: startId + i, actorUserId: 1, actionKey: "legacy", resourceId: null, createdAt: new Date(2026, 0, 1 + i), prevHash: null, recordHash: "" });
  }
  for (let i = 0; i < n; i++) {
    const base = { actorUserId: (i % 3) + 1, actionKey: `post /api/v1/x/${i}`, resourceId: i || null, createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)) };
    const hash = computeAuditRecordHash(prev, base);
    rows.push({ id: startId + legacy + i, ...base, prevHash: prev, recordHash: hash });
    prev = hash;
  }
  return rows;
}

describe("verifyAuditBatch — فحص سلسلة التدقيق على دفعات", () => {
  it("سلسلة سليمة تعدّي، وبنفس النتيجة سواء دفعة واحدة أو دفعات صغيرة", () => {
    const rows = chain(25);
    const whole = verifyAuditBatch(emptyChainState(), rows);
    expect(whole.verdict.valid).toBe(true);
    expect(whole.state.checked).toBe(25);

    let state = emptyChainState();
    for (let i = 0; i < rows.length; i += 4) {
      const step = verifyAuditBatch(state, rows.slice(i, i + 4));
      expect(step.verdict.valid).toBe(true);
      state = step.state;
    }
    expect(state.checked).toBe(25);
    expect(state.prevHash).toBe(whole.state.prevHash);
  });

  it("بيتخطى الصفوف القديمة اللي hash بتاعها فاضي بدل ما يعتبرها كسر", () => {
    const result = verifyAuditBatch(emptyChainState(), chain(5, 1, 3));
    expect(result.verdict.valid).toBe(true);
    expect(result.state.legacyUnsealed).toBe(3);
    expect(result.state.checked).toBe(5);
  });

  it("بيكشف أي تعديل في الحقول المغطّاة بالـhash", () => {
    const rows = chain(10);
    rows[6] = { ...rows[6], actionKey: "tampered" };
    const result = verifyAuditBatch(emptyChainState(), rows);
    expect(result.verdict).toEqual({ valid: false, firstInvalidId: rows[6].id, reason: "hash_mismatch" });
  });

  it("بيكشف الحذف من النص (prev_hash مش مطابق)", () => {
    const rows = chain(10);
    rows.splice(4, 1);
    const result = verifyAuditBatch(emptyChainState(), rows);
    expect(result.verdict.valid).toBe(false);
    if (!result.verdict.valid) expect(result.verdict.reason).toBe("prev_mismatch");
  });

  it("بيكشف الـfork: صفين كتبوا في نفس اللحظة بنفس prev_hash", () => {
    const rows = chain(6);
    const fork: AuditHashRow = { ...rows[3], id: rows[3].id + 100, actionKey: "concurrent write" };
    fork.recordHash = computeAuditRecordHash(fork.prevHash, fork);
    const result = verifyAuditBatch(emptyChainState(), [...rows.slice(0, 4), fork, ...rows.slice(4)]);
    expect(result.verdict.valid).toBe(false);
  });

  it("صف بدون hash بعد صفوف موقّعة = مخالفة (مش قديم)", () => {
    const rows = chain(3);
    rows.push({ id: 99, actorUserId: 1, actionKey: "late", resourceId: null, createdAt: new Date(), prevHash: null, recordHash: "" });
    const result = verifyAuditBatch(emptyChainState(), rows);
    expect(result.verdict).toEqual({ valid: false, firstInvalidId: 99, reason: "unsealed_after_sealed" });
  });

  it("المعادلة مطابقة للقديمة حرفيًا (توافق مع الصفوف الموجودة فعلًا)", () => {
    // نفس الصيغة اللي كانت في governance.ts و/governance/audit-events/verify، محسوبة هنا باستقلال تام
    const row = { actorUserId: 7, actionKey: "post /x", resourceId: 12, createdAt: new Date("2026-10-17T10:00:00.000Z") };
    const legacy = createHash("sha256")
      .update(["abc", row.actorUserId, row.actionKey, row.resourceId, row.createdAt.toISOString()].join(""))
      .digest("hex");
    expect(computeAuditRecordHash("abc", row)).toBe(legacy);
    const noPrev = createHash("sha256").update(["", "", "get /y", "", row.createdAt.toISOString()].join("")).digest("hex");
    expect(computeAuditRecordHash(null, { ...row, actorUserId: null, actionKey: "get /y", resourceId: null })).toBe(noPrev);
  });
});
