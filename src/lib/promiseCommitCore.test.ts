/** @format */
import { describe, expect, it } from "vitest";
import { commitIssue, driftDays, isClosedCase, standing, summarize, type PromiseRow } from "./promiseCommitCore";

const row = (id: number, caseId: number, d: string): PromiseRow => ({ id, caseId, promisedDate: d, confidencePercent: 80, method: "simulation", reason: null, createdAt: "2026-11-09T10:00:00.000Z" });

describe("تثبيت الوعد", () => {
  it("أول تثبيت من غير سبب، والتعديل بسبب 3 حروف", () => {
    expect(commitIssue({ hasPrevious: false, reason: null })).toBeNull();
    expect(commitIssue({ hasPrevious: true, reason: null })).toBe("reason");
    expect(commitIssue({ hasPrevious: true, reason: "  ab " })).toBe("reason");
    expect(commitIssue({ hasPrevious: true, reason: "تأخر خامة" })).toBeNull();
  });
  it("الحالات المقفولة", () => {
    for (const s of ["converted", "cancelled", "completed", "closed"]) expect(isClosedCase(s)).toBe(true);
    for (const s of ["received", "claimed", "in_review"]) expect(isClosedCase(s)).toBe(false);
  });
  it("الانحراف والموقف من الموعد", () => {
    expect(driftDays("2026-11-10", "2026-11-12")).toBe(2);
    expect(standing("2026-11-10", "2026-11-10")).toBe("within");
    expect(standing("2026-11-11", "2026-11-10")).toBe("over");
    expect(standing("2026-11-11", null)).toBe("none");
  });
  it("تلخيص الوعود: الأول والحالي وعدد التعديلات لكل حالة", () => {
    const s = summarize([row(5, 1, "2026-11-20"), row(3, 2, "2026-11-12"), row(2, 1, "2026-11-15"), row(1, 1, "2026-11-14")]);
    const c1 = s.find((x) => x.caseId === 1)!;
    expect(c1.first.id).toBe(1);
    expect(c1.current.id).toBe(5);
    expect(c1.revisions).toBe(2);
    const c2 = s.find((x) => x.caseId === 2)!;
    expect(c2.revisions).toBe(0);
    expect(c2.first.id).toBe(c2.current.id);
  });
});
