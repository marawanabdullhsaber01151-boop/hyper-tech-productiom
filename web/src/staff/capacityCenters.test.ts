import { describe, expect, it } from "vitest";
import { orderState, sortOrders, type CenterOrder } from "./capacityCore";

const o = (id: number, over: Partial<CenterOrder> = {}): CenterOrder => ({ id, orderNumber: `WF-${id}`, productName: "م", neededBy: "2026-11-20", finish: "2026-11-15", late: false, lateDays: -5, ...over });

describe("خريطة المراكز: عرض الأوامر", () => {
  it("حالة الأمر: متأخر / في الميعاد / من غير موعد", () => {
    expect(orderState(o(1, { late: true }))).toBe("late");
    expect(orderState(o(2))).toBe("onTime");
    expect(orderState(o(3, { neededBy: null }))).toBe("noDate");
  });
  it("المتأخر الأول والأكتر تأخيرًا فوق، وبحد أقصى", () => {
    const list = [o(1), o(2, { late: true, lateDays: 2 }), o(3, { late: true, lateDays: 9 }), o(4, { late: true, lateDays: null, finish: null })];
    expect(sortOrders(list).map((x) => x.id)).toEqual([4, 3, 2, 1]);
    expect(sortOrders(list, 2)).toHaveLength(2);
  });
});
