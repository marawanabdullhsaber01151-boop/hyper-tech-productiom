import { describe, expect, it } from "vitest";
import { formatCompanyCode, generateRawCompanyCode, normalizeCompanyCode } from "./companyCode";

describe("company code", () => {
  it("generates 8 chars of the readable alphabet with a valid check char", () => {
    for (let i = 0; i < 300; i += 1) {
      const raw = generateRawCompanyCode();
      expect(raw).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(normalizeCompanyCode(raw)).toBe(raw);
    }
  });
  it("formats as HT-XXXX-XXXX and parses it back", () => {
    const raw = generateRawCompanyCode();
    const shown = formatCompanyCode(raw);
    expect(shown).toMatch(/^HT-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(normalizeCompanyCode(shown)).toBe(raw);
    expect(normalizeCompanyCode(` ${shown.toLowerCase().replace(/-/g, " ")} `)).toBe(raw);
  });
  it("rejects typos via the check character and bad shapes", () => {
    const raw = generateRawCompanyCode();
    const wrongFirst = (raw[0] === "0" ? "1" : "0") + raw.slice(1);
    expect(normalizeCompanyCode(wrongFirst)).toBeNull();
    expect(normalizeCompanyCode("")).toBeNull();
    expect(normalizeCompanyCode("HT-1234")).toBeNull();
    expect(normalizeCompanyCode(null)).toBeNull();
    expect(normalizeCompanyCode("!!!!!!!!")).toBeNull();
  });
  it("forgives confusable letters (O→0, I/L→1, U→V)", () => {
    // build a code whose body has 0, 1 and V then type them as O, I, U
    let raw = "";
    do raw = generateRawCompanyCode();
    while (!/[01V]/.test(raw.slice(0, 7)));
    const typed = raw
      .slice(0, 7)
      .replace(/0/g, "O")
      .replace(/1/g, "I")
      .replace(/V/g, "U") + raw[7];
    expect(normalizeCompanyCode(typed)).toBe(raw);
  });
  it("is unlikely to collide", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateRawCompanyCode()));
    expect(seen.size).toBe(2000);
  });
});
