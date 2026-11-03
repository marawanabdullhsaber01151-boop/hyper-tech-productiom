import { describe, expect, it } from "vitest";
import {
  canManageFoundation, centerError, centerPayload, confirmEnabled, crossesMidnight, dailyShiftMinutes, descendantIds, dueState, formatSequence, foundationTabs, impactBody, locationPath, machineError,
  machineStats, parentCandidates, sequenceError, shiftError, shiftNetMinutes, todayISO,
  type Impact, type LocationRow, type MachineRow, type ShiftRow,
} from "./foundationCore";

const loc = (id: number, parentId: number | null, active = true): LocationRow => ({ id, code: `L${id}`, name: `موقع ${id}`, locationType: "warehouse", parentId, active, allowsInventory: true, allowsProduction: false, requiresQuarantine: false, notes: null });
const machine = (p: Partial<MachineRow> = {}): MachineRow => ({ id: 1, code: "M1", name: "ماكينة", workCenterId: 1, status: "available", serialNumber: null, calibrationDueDate: null, maintenanceDueDate: null, active: true, notes: null, ...p });
const impact = (blockers: Array<[string, number]>): Impact => ({ kind: "machine", id: 1, name: "م", active: true, blocked: blockers.some(([, n]) => n > 0), references: [], blockers: blockers.map(([type, count]) => ({ type, count, label: type, examples: [] })) });

describe("foundationCore: الصلاحيات والتبويبات", () => {
  it("التبويبات حسب الدور", () => {
    expect(foundationTabs("sales_manager")).toEqual([]);
    expect(foundationTabs("warehouse_manager")).toEqual(["locations", "centers", "machines", "shifts", "items", "sequences"]);
    expect(foundationTabs("chairman")).toContain("audit");
    expect(canManageFoundation("production_manager")).toBe(true);
  });
});

describe("foundationCore: الاستحقاق", () => {
  it("حالة المعايرة والصيانة", () => {
    expect(dueState(null, "2026-11-02")).toBe("none");
    expect(dueState("2026-11-01", "2026-11-02")).toBe("overdue");
    expect(dueState("2026-11-02", "2026-11-02")).toBe("soon");
    expect(dueState("2026-11-16", "2026-11-02")).toBe("soon");
    expect(dueState("2026-11-17", "2026-11-02")).toBe("ok");
  });
  it("إحصائيات الماكينات بتتجاهل الموقوف والمتقاعد", () => {
    const s = machineStats([
      machine({ calibrationDueDate: "2026-10-01" }),
      machine({ id: 2, status: "down", maintenanceDueDate: "2026-11-05" }),
      machine({ id: 3, status: "retired", calibrationDueDate: "2020-01-01" }),
      machine({ id: 4, active: false, calibrationDueDate: "2020-01-01" }),
    ], "2026-11-02");
    expect(s).toEqual({ total: 4, active: 2, down: 1, overdue: 1, soon: 1 });
  });
  it("تاريخ اليوم محليًا", () => expect(todayISO(new Date(2026, 10, 2))).toBe("2026-11-02"));
});

describe("foundationCore: الورديات", () => {
  it("المدة الصافية وعبور منتصف الليل", () => {
    expect(shiftNetMinutes("08:00", "16:00", 30)).toBe(450);
    expect(shiftNetMinutes("22:00", "06:00", 60)).toBe(420);
    expect(crossesMidnight("22:00", "06:00")).toBe(true);
    expect(crossesMidnight("08:00", "16:00")).toBe(false);
    expect(shiftNetMinutes("8:00", "16:00", 0)).toBe(0);
  });
  it("أخطاء النموذج", () => {
    const ok = { code: "S1", name: "صباحي", startTime: "08:00", endTime: "16:00", breakMinutes: "30" };
    expect(shiftError(ok)).toBeNull();
    expect(shiftError({ ...ok, startTime: "8" })).toBe("start");
    expect(shiftError({ ...ok, endTime: "24:00" })).toBe("end");
    expect(shiftError({ ...ok, breakMinutes: "900" })).toBe("break");
    expect(shiftError({ ...ok, startTime: "08:00", endTime: "08:00", breakMinutes: "1440" })).toBe("break");
    expect(shiftError({ ...ok, breakMinutes: "480" })).toBe("length");
    expect(shiftError({ ...ok, code: " " })).toBe("code");
  });
  it("مجموع دقايق الورديات النشطة بس", () => {
    const rows: ShiftRow[] = [
      { id: 1, code: "a", name: "a", startTime: "08:00", endTime: "16:00", breakMinutes: 0, active: true },
      { id: 2, code: "b", name: "b", startTime: "16:00", endTime: "00:00", breakMinutes: 0, active: false },
    ];
    expect(dailyShiftMinutes(rows)).toBe(480);
  });
});

describe("foundationCore: المواقع", () => {
  const rows = [loc(1, null), loc(2, 1), loc(3, 2), loc(4, null)];
  it("المسار والأحفاد", () => {
    expect(locationPath(rows, 3)).toBe("موقع 1 ‹ موقع 2 ‹ موقع 3");
    expect([...descendantIds(rows, 1)].sort()).toEqual([2, 3]);
  });
  it("المرشحين للأب بيستبعدوا النفس والأحفاد والموقوف", () => {
    expect(parentCandidates(rows, 1).map((r) => r.id)).toEqual([4]);
    expect(parentCandidates([...rows, loc(5, null, false)], null).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });
  it("دورة في البيانات ما تعلّقش", () => {
    const cyc = [loc(1, 2), loc(2, 1)];
    expect(locationPath(cyc, 1).length > 0).toBe(true);
    expect(descendantIds(cyc, 1).size > 0).toBe(true);
  });
});

describe("foundationCore: مراكز العمل والماكينات والعدّادات", () => {
  it("مركز عمل: السعة بأرقام عربية وحدود", () => {
    const f = { code: "WC", name: "خط", centerType: "", locationId: "", capacity: "٤٨٠", notes: "" };
    expect(centerError(f)).toBeNull();
    expect(centerPayload(f)).toMatchObject({ capacityMinutesPerShift: 480, centerType: "production_line", locationId: null });
    expect(centerError({ ...f, capacity: "0" })).toBe("capacity");
    expect(centerError({ ...f, capacity: "1441" })).toBe("capacity");
  });
  it("ماكينة: مركز العمل إجباري والتواريخ بصيغتها", () => {
    const f = { code: "M", name: "م", workCenterId: "", serialNumber: "", calibrationDueDate: "", maintenanceDueDate: "", notes: "" };
    expect(machineError(f)).toBe("center");
    expect(machineError({ ...f, workCenterId: "3", calibrationDueDate: "1/2/2026" })).toBe("calibration");
    expect(machineError({ ...f, workCenterId: "3", maintenanceDueDate: "2026-12-01" })).toBeNull();
  });
  it("العدّاد: المعاينة والتقليل ممنوع", () => {
    expect(formatSequence("PO-", 6, 42)).toBe("PO-000042");
    const f = { prefix: "PO-", padding: "6", nextValue: "10" };
    expect(sequenceError(f, 10)).toBeNull();
    expect(sequenceError({ ...f, nextValue: "9" }, 10)).toBe("lower");
    expect(sequenceError({ ...f, padding: "13" }, 10)).toBe("padding");
    expect(sequenceError({ ...f, prefix: " " }, 10)).toBe("prefix");
  });
});

describe("foundationCore: محاكي الأثر", () => {
  it("من غير مراجع حيّة التأكيد مفتوح، ومعاها لازم سبب", () => {
    expect(confirmEnabled(null, "x".repeat(10))).toBe(false);
    expect(confirmEnabled(impact([["a", 0]]), "")).toBe(true);
    expect(confirmEnabled(impact([["a", 2]]), "")).toBe(false);
    expect(confirmEnabled(impact([["a", 2]]), "ab")).toBe(false);
    expect(confirmEnabled(impact([["a", 2]]), " نقل الخط ")).toBe(true);
  });
  it("جسم الإيقاف", () => {
    expect(impactBody("  سبب  ", true)).toEqual({ active: false, overrideReason: "سبب" });
    expect(impactBody("", false)).toEqual({ active: false });
  });
});
