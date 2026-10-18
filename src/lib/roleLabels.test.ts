/** @format */
import { describe, expect, it } from "vitest";
import { ROLE_LABELS, roleLabel } from "./roleLabels";
import { USER_ROLES } from "./roles";

describe("roleLabels", () => {
  it("كل دور من الـ18 له اسم عربي (دور جديد بدون اسم = الاختبار يفشل)", () => {
    expect(USER_ROLES.length).toBe(18);
    for (const role of USER_ROLES) {
      expect(typeof ROLE_LABELS[role]).toBe("string");
      expect(ROLE_LABELS[role].trim().length).toBeGreaterThan(1);
    }
  });
  it("الأسماء مش مكررة، ودور مجهول يرجّع نفسه", () => {
    expect(new Set(Object.values(ROLE_LABELS)).size).toBe(USER_ROLES.length);
    expect(roleLabel("chairman")).toBe("رئيس مجلس الإدارة");
    expect(roleLabel("ghost")).toBe("ghost");
  });
});
