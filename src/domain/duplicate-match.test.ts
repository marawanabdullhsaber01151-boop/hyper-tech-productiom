/** @format */
import { describe, expect, it } from "vitest";
import { SIMILAR_MIN, classifyMatch, containsPattern, rankMatches } from "./duplicate-match";

describe("تكرار جهات الاتصال", () => {
  it("التصنيف بالأقوى: تليفون ثم شركة ثم تشابه", () => {
    expect(classifyMatch({ phoneHit: true, companyHit: true, score: 1 })).toBe("phone");
    expect(classifyMatch({ phoneHit: false, companyHit: true, score: 0.1 })).toBe("company");
    expect(classifyMatch({ phoneHit: false, companyHit: false, score: SIMILAR_MIN })).toBe("similar");
    expect(classifyMatch({ phoneHit: false, companyHit: false, score: SIMILAR_MIN - 0.01 })).toBeNull();
  });
  it("الترتيب: السبب الأقوى، ثم الأعلى تشابهًا، والضعيف بيتشال", () => {
    const rows = [
      { id: 1, phoneHit: false, companyHit: false, score: 0.6 },
      { id: 2, phoneHit: false, companyHit: false, score: 0.9 },
      { id: 3, phoneHit: true, companyHit: false, score: 0 },
      { id: 4, phoneHit: false, companyHit: false, score: 0.2 },
      { id: 5, phoneHit: false, companyHit: true, score: 0 },
    ];
    expect(rankMatches(rows).map((r) => [r.id, r.reason])).toEqual([[3, "phone"], [5, "company"], [2, "similar"], [1, "similar"]]);
  });
  it("نمط الاحتواء: 3 حروف على الأقل وبيهرّب % و_", () => {
    expect(containsPattern("ab")).toBeNull();
    expect(containsPattern("  النور  ")).toBe("%النور%");
    expect(containsPattern("a_b%c")).toBe("%a\\_b\\%c%");
  });
});
