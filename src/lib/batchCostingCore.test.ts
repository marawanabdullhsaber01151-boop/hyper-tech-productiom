import { describe, expect, it } from "vitest";
import {
  actualFor, actualTotal, bpText, centsText, computeSheet, divRound, materialPerBatch, milliText, parseCents, parseMilli, pickUnitPrice, standardBodySchema,
  standardFor, sum5, varianceTone, type Actual, type StandardInput,
} from "./batchCostingCore";

const STD: StandardInput = { outputQtyMilli: 100000n, materialPerBatchCents: 100000n, laborCents: 20000n, machineCents: 10000n, energyCents: 5000n, overheadCents: 5000n, yieldBp: 9500n };
const A = (o: Partial<Actual> = {}): Actual => ({ material: 0n, labor: 0n, machine: 0n, energy: 0n, overhead: 0n, waste: 0n, ...o });

describe("تحويل الأرقام", () => {
  it("بيقبل السالب والكسور وبيقرّب", () => {
    expect(parseCents("12.5")).toBe(1250n);
    expect(parseCents("-12.50")).toBe(-1250n);
    expect(parseCents("0.005")).toBe(1n);
    expect(parseMilli("2.5")).toBe(2500n);
    expect(() => parseCents("abc")).toThrow();
    expect(() => parseCents("1e3")).toThrow();
  });
  it("النص الراجع آمن للسالب (مفيش «.-»)", () => {
    expect(centsText(-150n)).toBe("-1.50");
    expect(centsText(-5n)).toBe("-0.05");
    expect(centsText(0n)).toBe("0.00");
    expect(milliText(-1500n)).toBe("-1.500");
    expect(bpText(-250n)).toBe("-2.50");
  });
  it("القسمة بتقرّب بعيدًا عن الصفر ومبتقسمش على صفر", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(1n, 3n)).toBe(0n);
    expect(() => divRound(1n, 0n)).toThrow();
  });
});

describe("المعيار", () => {
  it("الخامات من المكونات (الكمية × تكلفة الوحدة)", () => {
    expect(materialPerBatch([{ qty: "10", unitCost: "5.50" }, { qty: "0.5", unitCost: "3" }])).toBe(5650n);
  });
  it("المعياري بيتناسب مع الكمية المنتجة", () => {
    const s = standardFor(STD, 50000n);
    expect(s).toEqual({ material: 50000n, labor: 10000n, machine: 5000n, energy: 2500n, overhead: 2500n });
    expect(sum5(s)).toBe(70000n);
    expect(sum5(standardFor(STD, 200000n))).toBe(280000n);
  });
  it("حجم وصفة صفر مرفوض", () => {
    expect(() => standardFor({ ...STD, outputQtyMilli: 0n }, 1000n)).toThrow();
  });
});

describe("الفعلي", () => {
  const entries = [
    { costType: "material", amountCents: 60000n, batchId: 1 },
    { costType: "material", amountCents: 90000n, batchId: null },
    { costType: "labor", amountCents: -1000n, batchId: null },
    { costType: "scrap", amountCents: 500n, batchId: 2 },
    { costType: "rework", amountCents: 300n, batchId: null },
    { costType: "mystery", amountCents: 999999n, batchId: 1 },
  ];
  const batches = [{ id: 1, producedMilli: 30000n }, { id: 2, producedMilli: 10000n }];
  it("المباشر + نصيب من غير المنسوب بنسبة الإنتاج، والنوع المجهول بيتجاهل", () => {
    const a = actualFor(entries, 1, batches);
    expect(a.material).toBe(60000n + 67500n);
    expect(a.labor).toBe(-750n);
    expect(a.waste).toBe(225n);
  });
  it("قيد دفعة تانية مش بيدخل", () => {
    const a = actualFor(entries, 2, batches);
    expect(a.waste).toBe(500n + 75n);
    expect(a.material).toBe(22500n);
  });
  it("مفيش إنتاج: تقسيم بالتساوي", () => {
    const a = actualFor([{ costType: "energy", amountCents: 1000n, batchId: null }], 1, [{ id: 1, producedMilli: 0n }, { id: 2, producedMilli: 0n }]);
    expect(a.energy).toBe(500n);
  });
  it("المجموع بيشمل الهالك", () => {
    expect(actualTotal(A({ material: 100n, waste: 50n }))).toBe(150n);
  });
});

describe("سعر البيع", () => {
  const lines = [{ description: "  كيس  ٥ كجم", qty: "10", unitPrice: "20" }, { description: "كيس ٥ كجم", qty: "30", unitPrice: "24" }, { description: "حاجة تانية", qty: "5", unitPrice: "99" }];
  it("متوسط مرجّح للسطور بنفس الاسم", () => {
    expect(pickUnitPrice("كيس ٥ كجم", lines, "1")).toEqual({ priceCents: 2300n, source: "sales_line" });
  });
  it("سطر وحيد لو الاسم مختلف", () => {
    expect(pickUnitPrice("منتج", [{ description: "x", qty: "2", unitPrice: "7.5" }], null)).toEqual({ priceCents: 750n, source: "single_line" });
  });
  it("سعر الوصفة المرجعي بعدين مفيش", () => {
    expect(pickUnitPrice("منتج", lines, "15.25")).toEqual({ priceCents: 1525n, source: "recipe_reference" });
    expect(pickUnitPrice("منتج", lines, null)).toBeNull();
    expect(pickUnitPrice("منتج", [], "0")).toBeNull();
  });
});

describe("الكشف", () => {
  const base = { standard: STD, recipeMissing: false, producedMilli: 100000n, acceptedMilli: 95000n, scrapMilli: 5000n, reworkMilli: 0n, price: { priceCents: 3000n, source: "sales_line" as const } };
  it("على المعيار: انحراف صفر وفاقد كفاءة صفر", () => {
    const s = computeSheet({ ...base, actual: A({ material: 100000n, labor: 20000n, machine: 10000n, energy: 5000n, overhead: 5000n }) });
    expect(s.stdTotal).toBe(140000n);
    expect(s.variance.total).toBe(0n);
    expect(s.efficiencyLoss).toBe(0n);
    expect(varianceTone(s.variance.total)).toBe("neutral");
  });
  it("زيادة خامات وهالك: انحراف موجب (غير مفضّل) والمجموع مظبوط", () => {
    const s = computeSheet({ ...base, actual: A({ material: 112000n, labor: 20000n, machine: 10000n, energy: 5000n, overhead: 5000n, waste: 3000n }) });
    expect(s.variance.material).toBe(12000n);
    expect(s.variance.waste).toBe(3000n);
    expect(s.variance.total).toBe(15000n);
    expect(s.variance.material + s.variance.labor + s.variance.machine + s.variance.energy + s.variance.overhead + s.variance.waste).toBe(s.variance.total);
    expect(varianceTone(s.variance.total)).toBe("unfavorable");
  });
  it("توفير: انحراف سالب مفضّل", () => {
    const s = computeSheet({ ...base, actual: A({ material: 90000n, labor: 20000n, machine: 10000n, energy: 5000n, overhead: 5000n }) });
    expect(s.variance.total).toBe(-10000n);
    expect(varianceTone(s.variance.total)).toBe("favorable");
  });
  it("فاقد الكفاءة: السليم أقل من المتوقع بنسبة 95%", () => {
    const s = computeSheet({ ...base, acceptedMilli: 90000n, scrapMilli: 10000n, actual: A() });
    expect(s.efficiencyLoss).toBe(7000n); // 5 وحدات ناقصة × 1400 للوحدة
    const better = computeSheet({ ...base, acceptedMilli: 99000n, actual: A() });
    expect(better.efficiencyLoss).toBe(-5600n);
  });
  it("الربحية: إيراد = سعر × السليم، وربح = إيراد − الفعلي، وتكلفة الوحدة على السليم", () => {
    const s = computeSheet({ ...base, actual: A({ material: 100000n, labor: 20000n, machine: 10000n, energy: 5000n, overhead: 5000n }) });
    expect(s.revenueCents).toBe(285000n);
    expect(s.profitCents).toBe(145000n);
    expect(s.marginBp).toBe(5088n);
    expect(s.unitCostCents).toBe(1474n);
  });
  it("خسارة: ربح سالب ونسبة سالبة", () => {
    const s = computeSheet({ ...base, price: { priceCents: 1000n, source: "recipe_reference" }, actual: A({ material: 200000n }) });
    expect(s.profitCents).toBe(95000n - 200000n);
    expect(s.marginBp! < 0n).toBe(true);
  });
  it("تحذيرات: مفيش وصفة/معيار/سعر/إنتاج/سليم", () => {
    expect(computeSheet({ ...base, standard: null, recipeMissing: true, actual: A() }).warnings).toContain("NO_RECIPE");
    expect(computeSheet({ ...base, standard: null, actual: A() }).warnings).toContain("NO_STANDARD");
    expect(computeSheet({ ...base, price: null, actual: A() }).warnings).toContain("NO_PRICE");
    const none = computeSheet({ ...base, producedMilli: 0n, acceptedMilli: 0n, actual: A() });
    expect(none.warnings).toContain("NOTHING_PRODUCED");
    expect(none.unitCostCents).toBeNull();
    expect(none.efficiencyLoss).toBe(0n);
    const noAcc = computeSheet({ ...base, acceptedMilli: 0n, actual: A({ material: 1n }) });
    expect(noAcc.warnings).toContain("NO_ACCEPTED");
    expect(noAcc.revenueCents).toBeNull();
    expect(noAcc.profitCents).toBeNull();
  });
});

describe("مدخلات المعيار", () => {
  const ok = { labor: "10", machine: "5.5", energy: "0", overhead: "1", yieldPercent: "97.5", reason: "معيار جديد" };
  it("بيقبل الصح", () => {
    expect(standardBodySchema.safeParse(ok).success).toBe(true);
  });
  it("بيرفض السالب والخانات الزيادة والنسبة برّه 1–100 والسبب القصير", () => {
    for (const bad of [{ labor: "-1" }, { machine: "1.234" }, { energy: "abc" }, { yieldPercent: "0" }, { yieldPercent: "101" }, { yieldPercent: "99.999" }, { reason: "غ" }]) {
      expect(standardBodySchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
