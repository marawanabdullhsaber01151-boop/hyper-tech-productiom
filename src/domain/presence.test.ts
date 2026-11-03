/** @format */
import { describe, expect, it } from "vitest";
import { ONLINE_WINDOW_MS, collapseOnline, minutesAgo, onlineCutoff } from "./presence";

const now = new Date("2026-11-04T10:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("النشطين الآن", () => {
  it("النافذة 5 دقايق", () => {
    expect(onlineCutoff(now).getTime()).toBe(now.getTime() - ONLINE_WINDOW_MS);
  });
  it("الدقايق لتحت ومن غير سالب", () => {
    expect(minutesAgo(ago(59_000), now)).toBe(0);
    expect(minutesAgo(ago(61_000), now)).toBe(1);
    expect(minutesAgo(new Date(now.getTime() + 60_000), now)).toBe(0);
  });
  it("جلسات الشخص الواحد بتتجمّع بأحدث نشاط، وخارج النافذة بيتشال", () => {
    const rows = [
      { userId: 1, lastActiveAt: ago(4 * 60_000) },
      { userId: 1, lastActiveAt: ago(30_000) },
      { userId: 2, lastActiveAt: ago(2 * 60_000) },
      { userId: 3, lastActiveAt: ago(6 * 60_000) },
    ];
    expect(collapseOnline(rows, now)).toEqual([{ userId: 1, minutesAgo: 0 }, { userId: 2, minutesAgo: 2 }]);
  });
});
