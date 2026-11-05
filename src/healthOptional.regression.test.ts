/** @format */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defOf } from "./domain/settings-registry";
import { runAll } from "./lib/systemHealthCore";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("التحقق بخطوتين اختياري في صحة النظام", () => {
  it("الإعداد موجود، افتراضيه مقفول، وفي مجموعة الأمان", () => {
    const d = defOf("security.require_2fa_top");
    expect(d?.group).toBe("security");
    expect(d?.default).toBe("off");
  });
  it("فحص top_no_2fa بيقرا الإعداد ويتخطى لو مش مفعّل", () => {
    const s = src("./lib/systemHealth.ts");
    expect(/security\.require_2fa_top[\s\S]{0,80}skip: true/.test(s)).toBe(true);
  });
  it("runAll بيشيل الفحص المتخطّى من التقرير", async () => {
    const out = await runAll([
      { id: "a", group: "base", title: "أ", run: async () => ({ status: "ok", message: "" , skip: true }) },
      { id: "b", group: "base", title: "ب", run: async () => ({ status: "ok", message: "تمام" }) },
    ]);
    expect(out.map((c) => c.id)).toEqual(["b"]);
  });
  it("سجل التدقيق في الصحة والـverify بيستخدموا تسامح التفرّع القديم", () => {
    expect(src("./lib/systemHealth.ts").includes("forkToleratedBefore: AUDIT_FORK_TOLERATED_BEFORE")).toBe(true);
    expect(src("./routes/governance.ts").includes("forkToleratedBefore: AUDIT_FORK_TOLERATED_BEFORE")).toBe(true);
  });
});
