/** @format */

import { describe, expect, it } from "vitest";
import { SESSION_TOUCH_INTERVAL_MS, shouldTouchSession } from "./sessionTouch";

const now = new Date("2026-10-17T10:00:00.000Z");

describe("shouldTouchSession", () => {
  it("بيحدّث لو مفيش قيمة سابقة", () => {
    expect(shouldTouchSession(null, now)).toBe(true);
    expect(shouldTouchSession(undefined, now)).toBe(true);
  });
  it("ما بيحدّثش لو آخر تحديث أحدث من دقيقة", () => {
    expect(shouldTouchSession(new Date(now.getTime() - 5_000), now)).toBe(false);
    expect(shouldTouchSession(new Date(now.getTime() - (SESSION_TOUCH_INTERVAL_MS - 1)), now)).toBe(false);
  });
  it("بيحدّث عند الدقيقة أو بعدها", () => {
    expect(shouldTouchSession(new Date(now.getTime() - SESSION_TOUCH_INTERVAL_MS), now)).toBe(true);
    expect(shouldTouchSession(new Date(now.getTime() - 3_600_000), now)).toBe(true);
  });
  it("بيحدّث لو القيمة المخزنة في المستقبل (انحراف ساعة)", () => {
    expect(shouldTouchSession(new Date(now.getTime() + 10_000), now)).toBe(true);
  });
});
