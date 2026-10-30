import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("هجرة 0086: طلب التفعيل يقبل حالة closed", () => {
  const sql = read("migrations/0086_activation_status_closed.sql");

  it("بتعدّل القيد نفسه وتضيف closed من غير ما تشيل القيم القديمة", () => {
    expect(sql).toContain("portal_activation_requests_status_check");
    expect(sql).toMatch(/CHECK \(status IN \('pending', 'confirmed', 'rejected', 'closed'\)\)/);
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS portal_activation_requests_status_check");
  });

  it("مسار القفل في الكود بيكتب نفس القيمة اللي القيد بيسمح بيها", () => {
    expect(read("src/routes/portal-activation-admin.ts")).toContain('status: "closed"');
  });

  it("مكتوب فيها Rollback", () => {
    expect(sql).toContain("Rollback");
  });
});
