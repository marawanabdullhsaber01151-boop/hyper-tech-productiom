/** @format */
import { describe, expect, it } from "vitest";
import {
  completenessScore, levenshtein, matchRecord, missingFields, nameSimilarity,
  normalizeArabicName, slaState, statusForStage,
} from "./applicationMatching";

describe("normalizeArabicName", () => {
  it("ignores diacritics, alef forms, ta marbuta and company words", () => {
    expect(normalizeArabicName("شركة الأمَل للتجارة")).toBe(normalizeArabicName("امل"));
    expect(normalizeArabicName("مؤسسة إبراهيم")).toBe("ابراهيم");
  });
});

describe("nameSimilarity", () => {
  it("is 1 for the same name written differently", () => {
    expect(nameSimilarity("شركة النور", "النور")).toBe(1);
  });
  it("is high for small typos and low for different names", () => {
    expect(nameSimilarity("مطاحن الشروق", "مطاحن الشرووق")).toBeGreaterThan(0.8);
    expect(nameSimilarity("مطاحن الشروق", "بلاستيك الدلتا")).toBeLessThan(0.5);
  });
  it("levenshtein basics", () => {
    expect(levenshtein("abc", "abd")).toBe(1);
    expect(levenshtein("", "ab")).toBe(2);
  });
});

describe("matchRecord", () => {
  const app = { phone: "01012345678", email: "A@x.com", companyName: "شركة النور" };
  it("matches by phone in any format", () => {
    const m = matchRecord(app, { phone: "+201012345678", name: "حاجة تانية" });
    expect(m?.reasons).toEqual(["phone"]);
    expect(m?.confidence).toBe("high");
  });
  it("matches by email only as medium", () => {
    const m = matchRecord(app, { email: "a@X.com", name: "xyz" });
    expect(m?.confidence).toBe("medium");
  });
  it("matches by name only", () => {
    const m = matchRecord(app, { name: "النور" });
    expect(m?.reasons).toEqual(["name"]);
  });
  it("returns null for no match", () => {
    expect(matchRecord(app, { phone: "01111111111", name: "بلاستيك" })).toBeNull();
  });
});

describe("completeness", () => {
  it("scores and lists missing", () => {
    const full = { fullName: "a", companyName: "b", phone: "1", address: "x", city: "c", email: "e", commercialRegisterNo: "r", taxId: "t", expectedMonthlyVolume: "v" };
    expect(completenessScore(full)).toBe(100);
    expect(completenessScore({ fullName: "a", companyName: "b", phone: "1" })).toBe(45);
    expect(missingFields({ ...full, taxId: "" })).toEqual(["taxId"]);
  });
});

describe("slaState", () => {
  const limits = { warnHours: 24, lateHours: 48 };
  const now = new Date("2026-01-03T00:00:00Z");
  it("ok / warn / late / done", () => {
    expect(slaState(new Date("2026-01-02T12:00:00Z"), "new", limits, now).state).toBe("ok");
    expect(slaState(new Date("2026-01-02T00:00:00Z"), "new", limits, now).state).toBe("warn");
    expect(slaState(new Date("2026-01-01T00:00:00Z"), "ready", limits, now).state).toBe("late");
    expect(slaState(new Date("2026-01-01T00:00:00Z"), "approved", limits, now).state).toBe("done");
    expect(slaState(new Date("2026-01-01T00:00:00Z"), "needs_info", limits, now).state).toBe("ok");
  });
  it("maps stage to legacy status", () => {
    expect(statusForStage("ready")).toBe("pending");
    expect(statusForStage("duplicate_auto_closed")).toBe("rejected");
  });
});
