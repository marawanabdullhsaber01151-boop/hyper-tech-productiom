import { describe, expect, it } from "vitest";
import { loadBand, pct, verdictTone } from "./capacityCore";

describe("عرض السعة", () => {
  it("تلوين اليوم حسب التحميل", () => {
    expect(loadBand(0.2)).toBe("free");
    expect(loadBand(0.6)).toBe("busy");
    expect(loadBand(0.85)).toBe("busy");
    expect(loadBand(1)).toBe("full");
  });
  it("النسبة والحكم", () => {
    expect(pct(0.426)).toBe(43);
    expect(verdictTone("ok")).toBe("success");
    expect(verdictTone("tight")).toBe("warn");
    expect(verdictTone("late")).toBe("danger");
    expect(verdictTone("none")).toBe("neutral");
  });
});
