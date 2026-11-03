import { describe, expect, it } from "vitest";
import { onlineKind, EMPTY_FILTERS, activityQuery, canSeeActivity, filtersError, groupByDay, mergeRows, type ActivityRow } from "./activityCore";

const row = (id: number, whenText: string): ActivityRow => ({ id, sentence: `s${id}`, whenText, createdAt: "2026-11-03T10:00:00Z", actorUserId: 1, section: "sales", sectionLabel: "المبيعات", rejected: false });

describe("سجل النشاط", () => {
  it("الإدارة العليا بس", () => {
    expect(canSeeActivity("chairman")).toBe(true);
    expect(canSeeActivity("executive_manager")).toBe(true);
    expect(canSeeActivity("sales_manager")).toBe(false);
    expect(canSeeActivity(undefined)).toBe(false);
  });
  it("الاستعلام بيسقط الفاضي ويرمّز", () => {
    expect(activityQuery(EMPTY_FILTERS)).toBe("");
    expect(activityQuery({ actorId: "5", section: "sales", from: "2026-11-01", to: "2026-11-03", includeViews: true }, 42)).toBe("?before=42&actorId=5&section=sales&from=2026-11-01&to=2026-11-03&includeViews=1");
    expect(activityQuery({ ...EMPTY_FILTERS, actorId: "x", from: "2026-11-01" })).toBe("");
  });
  it("الفترة لازم كاملة ومرتبة", () => {
    expect(filtersError(EMPTY_FILTERS)).toBeNull();
    expect(filtersError({ ...EMPTY_FILTERS, from: "2026-11-01" })).toBe("range");
    expect(filtersError({ ...EMPTY_FILTERS, from: "2026-11-05", to: "2026-11-01" })).toBe("range");
    expect(filtersError({ ...EMPTY_FILTERS, from: "2026-11-01", to: "2026-11-01" })).toBeNull();
  });
  it("التجميع بالأيام بيحافظ على الترتيب ويفصل الوقت", () => {
    const g = groupByDay([row(3, "2026/11/03 08:13 ص"), row(2, "2026/11/03 07:00 ص"), row(1, "2026/11/02 11:45 م")]);
    expect(g.map((d) => [d.day, d.rows.length])).toEqual([["2026/11/03", 2], ["2026/11/02", 1]]);
    expect(g[0]!.rows[0]!.time).toBe("08:13 ص");
  });
  it("الدمج من غير تكرار", () => {
    expect(mergeRows([row(3, "a"), row(2, "b")], [row(2, "b"), row(1, "c")]).map((r) => r.id)).toEqual([3, 2, 1]);
  });
  it("صياغة النشطين الآن", () => {
    expect(onlineKind(0)).toBe("now");
    expect(onlineKind(1)).toBe("ago");
    expect(onlineKind(4)).toBe("ago");
  });
});
