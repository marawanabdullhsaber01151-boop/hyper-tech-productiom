/** @format */
import { describe, expect, it } from "vitest";
import { buildCenterSchedule, centerDailyMinutes, opMinutes, parseRouting, type OrderInput } from "./capacityCentersCore";

// 2026-11-08 = أحد (يوم عمل). السعة اليومية 480 × 0.85 = 408 دقيقة.
const START = "2026-11-08";
const centers = [
  { id: 1, code: "MIX", name: "الخلط", dailyMinutes: 480 },
  { id: 2, code: "PACK", name: "التعبئة", dailyMinutes: 480 },
];
const order = (id: number, over: Partial<OrderInput> = {}): OrderInput => ({
  id,
  orderNumber: `WF-${id}`,
  productName: "منتج",
  neededBy: null,
  qty: 100,
  status: "released",
  routing: [{ operationNo: 10, workCenterId: 1, setupMinutes: 8, runMinutesPerUnit: 2 }],
  ...over,
});

describe("قراءة المسار", () => {
  it("بتقبل camel وsnake وبترتب برقم العملية", () => {
    const ops = parseRouting([
      { operation_no: 20, work_center_id: 2, setup_minutes: 5, run_minutes_per_unit: "1.5" },
      { operationNo: 10, workCenterId: 1, setupMinutes: 0, runMinutesPerUnit: 1 },
    ]);
    expect(ops.map((o) => o.operationNo)).toEqual([10, 20]);
    expect(ops[1]).toMatchObject({ workCenterId: 2, setupMinutes: 5, runMinutesPerUnit: 1.5 });
  });
  it("القيم الغلط أو غير المصفوفة بتتجاهل", () => {
    expect(parseRouting(null)).toEqual([]);
    expect(parseRouting([{ operationNo: "x", workCenterId: -3, runMinutesPerUnit: -5 }])[0]).toMatchObject({ workCenterId: null, runMinutesPerUnit: 0 });
  });
  it("دقايق العملية = تجهيز + تشغيل × الكمية", () => {
    expect(opMinutes({ operationNo: 1, workCenterId: 1, setupMinutes: 8, runMinutesPerUnit: 2 }, 100)).toBe(208);
  });
  it("سعة المركز = سعة الوردية × عدد الورديات (واحدة على الأقل)", () => {
    expect(centerDailyMinutes(480, 2)).toBe(960);
    expect(centerDailyMinutes(480, 0)).toBe(480);
  });
});

describe("الجدولة بالمراكز", () => {
  it("أمر 208 دقيقة بيدخل في يوم واحد (408 سعة)", () => {
    const r = buildCenterSchedule({ orders: [order(1)], centers, startIso: START });
    expect(r.centers[0]?.days[0]).toMatchObject({ used: 208, capacity: 408 });
    expect(r.orders[0]?.finish).toBe(START);
  });
  it("الزيادة عن سعة اليوم بتتوزع على اليوم اللي بعده", () => {
    const r = buildCenterSchedule({ orders: [order(1, { qty: 300 })], centers, startIso: START }); // 608
    expect(r.centers[0]?.days[0]?.used).toBe(408);
    expect(r.centers[0]?.days[1]?.used).toBe(200);
    expect(r.orders[0]?.finish).toBe("2026-11-09");
  });
  it("العملية التانية بتبدأ بعد الأولى: أمر بعمليتين على مركزين", () => {
    const routing = [
      { operationNo: 10, workCenterId: 1, setupMinutes: 0, runMinutesPerUnit: 5 }, // 500 = يوم وشوية
      { operationNo: 20, workCenterId: 2, setupMinutes: 0, runMinutesPerUnit: 1 },
    ];
    const r = buildCenterSchedule({ orders: [order(1, { routing })], centers, startIso: START });
    expect(r.centers[1]?.days[0]?.used).toBe(0); // التعبئة ما بتبدأش قبل ما الخلط يوصل لليوم التاني
    expect(r.centers[1]?.days[1]?.used).toBe(100);
    expect(r.orders[0]?.finish).toBe("2026-11-09");
  });
  it("الأقرب موعدًا ياخد الأولوية، والمتأخر بيتعلّم بعدد الأيام", () => {
    const a = order(1, { qty: 150, neededBy: "2026-11-30" }); // 308
    const b = order(2, { qty: 150, neededBy: "2026-11-08" }); // 308
    const r = buildCenterSchedule({ orders: [a, b], centers, startIso: START });
    const rb = r.orders.find((x) => x.id === 2);
    const ra = r.orders.find((x) => x.id === 1);
    expect(rb).toMatchObject({ finish: START, late: false });
    expect(ra?.finish).toBe("2026-11-09");
    const tight = buildCenterSchedule({ orders: [order(3, { qty: 300, neededBy: START })], centers, startIso: START });
    expect(tight.orders[0]).toMatchObject({ late: true, lateDays: 1 });
  });
  it("الجزء المتبقي من الأمر حسب مرحلته (تحت التصنيع = النص)", () => {
    const r = buildCenterSchedule({ orders: [order(1, { status: "in_production" })], centers, startIso: START });
    expect(r.centers[0]?.days[0]?.used).toBe(104);
  });
  it("الأمر المنتهي ما بيتحسبش", () => {
    const r = buildCenterSchedule({ orders: [order(1, { status: "completed" })], centers, startIso: START });
    expect(r.scheduledOrders).toBe(0);
    expect(r.noRoutingOrders).toBe(0);
  });
  it("من غير مسار أو بمركز مش معرّف: بيتعدّ ومش بيتجدول", () => {
    const r = buildCenterSchedule({
      orders: [order(1, { routing: [] }), order(2, { routing: [{ operationNo: 10, workCenterId: 99, runMinutesPerUnit: 1 }] }), order(3, { routing: [{ operationNo: 10, workCenterId: 1, runMinutesPerUnit: 1 }, { operationNo: 20, workCenterId: null, runMinutesPerUnit: 1 }] })],
      centers,
      startIso: START,
    });
    expect(r.noRoutingOrders).toBe(2);
    expect(r.unassignedOps).toBe(2);
    expect(r.scheduledOrders).toBe(1);
  });
  it("الخميس والسبت أيام عمل والجمعة لأ", () => {
    const r = buildCenterSchedule({ orders: [order(1, { qty: 600 })], centers, startIso: "2026-11-12", shownDays: 3 }); // خميس
    expect(r.centers[0]?.days.map((d) => d.date)).toEqual(["2026-11-12", "2026-11-14", "2026-11-15"]);
  });
  it("لو الشغل أكبر من الأفق: التاريخ فاضي والأمر متأخر لو له موعد", () => {
    const r = buildCenterSchedule({ orders: [order(1, { qty: 100000, neededBy: "2026-12-01" })], centers, startIso: START, horizon: 5 });
    expect(r.orders[0]).toMatchObject({ finish: null, late: true, lateDays: null });
  });
});
