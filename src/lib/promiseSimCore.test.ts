/** @format */
import { describe, expect, it } from "vitest";
import type { CenterInput, OrderInput } from "./capacityCentersCore";
import { FAR, durationFactor, mulberry32, percentileDate, seedOf, simulatePromise, triangular } from "./promiseSimCore";

const centers: CenterInput[] = [{ id: 1, code: "MIX", name: "الخلط", dailyMinutes: 480 }];
const routing = [{ operationNo: 10, workCenterId: 1, setupMinutes: 0, runMinutesPerUnit: 2 }];
const START = "2026-11-08";
const q = (id: number, qty: number): OrderInput => ({ id, orderNumber: `WF-${id}`, productName: "م", neededBy: null, qty, status: "released", routing });
const base = { centers, startIso: START, dueDate: null as string | null, variability: 0.2, confidence: 0.8, seed: 7 };

describe("المولّد والتوزيع", () => {
  it("نفس البذرة = نفس السلسلة، وكلها بين 0 و1", () => {
    const a = mulberry32(5), b = mulberry32(5);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
  it("المثلثي بيفضل جوه الحدود والمعامل 0.9…1.3 لتذبذب 20%", () => {
    for (const u of [0, 0.01, 0.25, 0.5, 0.75, 0.99]) {
      expect(triangular(u, 1, 2, 4)).toBeGreaterThanOrEqual(1);
      expect(triangular(u, 1, 2, 4)).toBeLessThanOrEqual(4);
      const f = durationFactor(u, 0.2);
      expect(f).toBeGreaterThanOrEqual(0.9 - 1e-9);
      expect(f).toBeLessThanOrEqual(1.3 + 1e-9);
    }
    expect(durationFactor(0.5, 0)).toBe(1);
  });
  it("المتوسط مايل لفوق (التأخير أشيع من التبكير)", () => {
    const r = mulberry32(1);
    const n = 4000;
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += durationFactor(r(), 0.2);
    expect(sum / n).toBeGreaterThan(1.03);
  });
  it("النسبة من التواريخ المرتبة", () => {
    const d = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    expect(percentileDate(d, 0.5)).toBe("e");
    expect(percentileDate(d, 0.8)).toBe("h");
    expect(percentileDate(d, 1)).toBe("j");
    expect(percentileDate([], 0.8)).toBe(FAR);
  });
  it("البذرة من أجزاء ثابتة", () => {
    expect(seedOf([1, "2026-11-08", 5])).toBe(seedOf([1, "2026-11-08", 5]));
    expect(seedOf([1, "2026-11-08", 5])).not.toBe(seedOf([2, "2026-11-08", 5]));
  });
});

describe("المحاكاة", () => {
  const input = { ...base, queue: [q(1, 300), q(2, 300)], lines: [{ qty: 200, routing }] };
  it("نفس المدخلات بتدّي نفس الأرقام (مفيش تنطيط)", () => {
    expect(simulatePromise(input)).toEqual(simulatePromise(input));
  });
  it("الترتيب: أقرب ≤ أرجح ≤ وعد بالثقة ≤ أبعد", () => {
    const p = simulatePromise(input)!;
    expect(p.earliest <= p.likely).toBe(true);
    expect(p.likely <= p.confidenceDate).toBe(true);
    expect(p.confidenceDate <= p.latest).toBe(true);
    expect(p.runs).toBe(300);
  });
  it("ثقة أعلى = وعد أبعد أو مساوي", () => {
    const lo = simulatePromise({ ...input, confidence: 0.5 })!;
    const hi = simulatePromise({ ...input, confidence: 0.95 })!;
    expect(hi.confidenceDate >= lo.confidenceDate).toBe(true);
  });
  it("تذبذب صفر = حساب ثابت بتشغيلة واحدة وكل الأرقام متساوية", () => {
    const p = simulatePromise({ ...input, variability: 0 })!;
    expect(p.runs).toBe(1);
    expect(new Set([p.earliest, p.likely, p.confidenceDate, p.latest]).size).toBe(1);
    // 600 + 600 + 400 = 1600 دقيقة على 408 في اليوم = 4 أيام: 8 و9 و10 و11
    expect(p.likely).toBe("2026-11-11");
  });
  it("الحكم: في الميعاد / ضيّق / متأخر", () => {
    expect(simulatePromise({ ...input, variability: 0, dueDate: "2026-12-30" })?.verdict).toBe("ok");
    expect(simulatePromise({ ...input, variability: 0, dueDate: "2026-11-09" })?.verdict).toBe("late");
    const wide = simulatePromise({ ...input, dueDate: "2026-12-30" })!;
    expect(wide.verdict).toBe("ok");
  });
  it("سطر من غير مسار أو من غير سطور = null", () => {
    expect(simulatePromise({ ...input, lines: [{ qty: 10, routing: [] }] })).toBeNull();
    expect(simulatePromise({ ...input, lines: [] })).toBeNull();
  });
  it("طابور فاضي وطلب صغير: نفس اليوم في الأرجح", () => {
    const p = simulatePromise({ ...base, queue: [], lines: [{ qty: 50, routing }] })!;
    expect(p.likely).toBe(START);
  });
});
