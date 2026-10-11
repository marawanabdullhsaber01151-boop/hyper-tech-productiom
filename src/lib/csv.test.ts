import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("بيهرّب علامات الاقتباس", () => expect(csvCell('a"b')).toBe('"a""b"'));
  it("بيمنع حقن الصيغ", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) {
      expect(csvCell(bad).startsWith(`"'`)).toBe(true);
    }
    expect(csvCell("عادي")).toBe('"عادي"');
    expect(csvCell(null)).toBe('""');
  });
  it("بيبدأ بـ BOM", () => expect(toCsv([["a"]]).charCodeAt(0)).toBe(0xfeff));
});
