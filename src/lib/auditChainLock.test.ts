import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** حراسة: تسجيل التدقيق لازم يتسلسل بقفل، وإلا الكتابة المتزامنة بتفرّع السلسلة وصحة النظام تقول "مكسورة". */
describe("writeAuditEvent", () => {
  const src = readFileSync(new URL("./governance.ts", import.meta.url), "utf8");
  it("بياخد قفل استشاري قبل قراءة آخر hash", () => {
    const lock = src.indexOf("pg_advisory_xact_lock");
    const read = src.indexOf("select({ recordHash");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(read);
  });
  it("من غير tx بيفتح معاملة عشان القفل والإضافة يبقوا ذرّة واحدة", () => {
    expect(src).toContain("db.transaction((tx) => writeAuditEvent(");
  });
});
