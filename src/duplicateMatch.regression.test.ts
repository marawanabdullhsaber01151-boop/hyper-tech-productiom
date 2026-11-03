/** @format */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("خطوة 38ب — تشابه الأسماء (pg_trgm)", () => {
  it("الهجرة بتفعّل الامتداد بس", () => {
    const m = read("../migrations/0092_pg_trgm.sql");
    expect(m).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect(/CREATE TABLE|ALTER TABLE|DROP TABLE|DELETE FROM/.test(m)).toBe(false);
  });

  it("فحص التكرار: تليفون + شركة بالاحتواء (مايعتمدش على pg_trgm لوحده) + تشابه، والرد من غير حقول داخلية", () => {
    const r = read("./routes/contacts.ts");
    const i = r.indexOf('"/contacts/duplicate-check"');
    expect(i).toBeGreaterThan(-1);
    const h = r.slice(i, i + 4200);
    expect(h).toContain("requireRole(...PERMISSIONS.contacts.view)");
    expect(h).toContain("similarity(");
    expect(h).toContain("ILIKE");
    expect(h).toContain("rankMatches(rows)");
    expect(h).toContain(".limit(25)");
    const out = h.slice(h.indexOf(".map(({ id"));
    expect(out).not.toContain("score");
  });
});
