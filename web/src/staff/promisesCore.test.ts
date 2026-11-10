import { describe, expect, it } from "vitest";
import { driftDays, driftState, reasonNeeded, reasonOk, sortSummaries, standingTone, type PromiseRow, type PromiseSummary } from "./promisesCore";

const row = (id: number, d: string): PromiseRow => ({ id, caseId: 1, promisedDate: d, confidencePercent: 80, method: "simulation", reason: null, createdAt: "2026-11-09T10:00:00Z" });
const sum = (n: number, d: string, standing: PromiseSummary["standing"]): PromiseSummary => ({ caseId: n, caseNumber: `C-${n}`, customer: null, dueDate: null, first: row(n, d), current: row(n, d), revisions: 0, standing });

describe("وعود التسليم المثبّتة", () => {
  it("الانحراف بالأيام بين المثبّت والمحسوب", () => {
    expect(driftDays("2026-11-10", "2026-11-13")).toBe(3);
    expect(driftDays("2026-11-10", "2026-11-08")).toBe(-2);
    expect(driftDays("2026-11-10T00:00:00.000Z", "2026-11-10")).toBe(0);
    expect(driftState(3)).toBe("later");
    expect(driftState(-1)).toBe("earlier");
    expect(driftState(0)).toBe("same");
  });
  it("السبب مطلوب للتعديل بس وبـ3 حروف", () => {
    expect(reasonNeeded(false)).toBe(false);
    expect(reasonNeeded(true)).toBe(true);
    expect(reasonOk("  ab ")).toBe(false);
    expect(reasonOk("تأخر خامة")).toBe(true);
  });
  it("المتجاوز للموعد الأول ثم الأقرب تاريخًا", () => {
    const list = [sum(1, "2026-11-12", "within"), sum(2, "2026-11-20", "over"), sum(3, "2026-11-10", "none"), sum(4, "2026-11-15", "over")];
    expect(sortSummaries(list).map((s) => s.caseId)).toEqual([4, 2, 3, 1]);
    expect(standingTone("within")).toBe("success");
    expect(standingTone("over")).toBe("danger");
    expect(standingTone("none")).toBe("neutral");
  });
});
