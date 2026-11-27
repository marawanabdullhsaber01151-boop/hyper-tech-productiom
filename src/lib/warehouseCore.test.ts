import { describe, expect, it } from "vitest";
import {
  ALLOWED_KINDS, DEFAULT_KIND_OF, defaultKindOf, fromMilli, kindAllowed, planOut, planRelease, planReserve, toMilli, totalsOf,
  type BalanceRow,
} from "./warehouseCore";

const row = (warehouseId: number, qty: number, reserved = 0, isDefault = false): BalanceRow => ({ warehouseId, qty: toMilli(qty), reserved: toMilli(reserved), isDefault });

describe("قاعدة النوع والصنف", () => {
  it("الخام: خام وتحت تشغيل بس. التام: تحت تشغيل وتام. نص المصنّع: تحت تشغيل بس", () => {
    expect(kindAllowed("raw_material", "raw")).toBe(true);
    expect(kindAllowed("raw_material", "wip")).toBe(true);
    expect(kindAllowed("raw_material", "finished")).toBe(false);
    expect(kindAllowed("finished_good", "finished")).toBe(true);
    expect(kindAllowed("finished_good", "wip")).toBe(true);
    expect(kindAllowed("finished_good", "raw")).toBe(false);
    expect(kindAllowed("wip", "wip")).toBe(true);
    expect(kindAllowed("wip", "raw")).toBe(false);
    expect(kindAllowed("wip", "finished")).toBe(false);
  });
  it("فئة أو نوع مجهول = مرفوض", () => {
    expect(kindAllowed("mystery", "raw")).toBe(false);
    expect(kindAllowed("raw_material", "mystery")).toBe(false);
  });
  it("الافتراضي دايمًا مسموح", () => {
    for (const c of Object.keys(DEFAULT_KIND_OF)) expect(ALLOWED_KINDS[c as keyof typeof ALLOWED_KINDS]).toContain(DEFAULT_KIND_OF[c as keyof typeof DEFAULT_KIND_OF]);
    expect(defaultKindOf("finished_good")).toBe("finished");
    expect(defaultKindOf("whatever")).toBe("raw");
  });
});

describe("الألف (milli) من غير كسور عايمة", () => {
  it("0.1 + 0.2 بالألف = 0.3 بالظبط", () => {
    expect(toMilli("0.1") + toMilli("0.2")).toBe(toMilli("0.3"));
    expect(fromMilli(toMilli("12.345"))).toBe("12.345");
  });
});

describe("planOut", () => {
  it("مخزن واحد يغطي: بيتصرف منه (الافتراضي أولًا)", () => {
    const r = planOut([row(2, 50), row(1, 50, 0, true)], toMilli(30));
    expect(r).toEqual({ ok: true, shares: [{ warehouseId: 1, amount: toMilli(30) }] });
  });
  it("مخزن واحد غير الافتراضي هو اللي يغطي: بياخد منه ومش بيقسّم", () => {
    const r = planOut([row(1, 10, 0, true), row(2, 50)], toMilli(30));
    expect(r).toEqual({ ok: true, shares: [{ warehouseId: 2, amount: toMilli(30) }] });
  });
  it("مفيش مخزن لوحده يغطي: بيتوزع بالترتيب والمجموع = المطلوب", () => {
    const r = planOut([row(1, 10, 0, true), row(2, 15), row(3, 20)], toMilli(40));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shares).toEqual([{ warehouseId: 1, amount: toMilli(10) }, { warehouseId: 2, amount: toMilli(15) }, { warehouseId: 3, amount: toMilli(15) }]);
      expect(r.shares.reduce((a, s) => a + s.amount, 0)).toBe(toMilli(40));
    }
  });
  it("الإجمالي مش كفاية: بيرفض ويقول الناقص (مفيش رصيد سالب)", () => {
    expect(planOut([row(1, 10, 0, true), row(2, 5)], toMilli(20))).toEqual({ ok: false, short: toMilli(5) });
  });
  it("مفيش أرصدة خالص: مرفوض", () => {
    expect(planOut([], toMilli(1))).toEqual({ ok: false, short: toMilli(1) });
  });
  it("كمية صفر أو سالبة أو كسر ألف: مرفوضة", () => {
    expect(planOut([row(1, 10, 0, true)], 0).ok).toBe(false);
    expect(planOut([row(1, 10, 0, true)], -5).ok).toBe(false);
    expect(planOut([row(1, 10, 0, true)], 0.5).ok).toBe(false);
  });
});

describe("planReserve / planRelease", () => {
  it("الحجز على المتاح بس (الكمية - المحجوز)", () => {
    const rows = [row(1, 10, 8, true), row(2, 10, 0)];
    expect(planReserve(rows, toMilli(5))).toEqual({ ok: true, shares: [{ warehouseId: 2, amount: toMilli(5) }] });
    const r = planReserve(rows, toMilli(12));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.shares).toEqual([{ warehouseId: 1, amount: toMilli(2) }, { warehouseId: 2, amount: toMilli(10) }]);
    expect(planReserve(rows, toMilli(13))).toEqual({ ok: false, short: toMilli(1) });
  });
  it("فك الحجز بس من اللي فيه محجوز، وأكتر من المحجوز مرفوض", () => {
    const rows = [row(1, 10, 0, true), row(2, 10, 4)];
    expect(planRelease(rows, toMilli(3))).toEqual({ ok: true, shares: [{ warehouseId: 2, amount: toMilli(3) }] });
    expect(planRelease(rows, toMilli(5))).toEqual({ ok: false, short: toMilli(1) });
  });
});

describe("الثابت: مجموع الحصص = المطلوب، والإجمالي بعد التنفيذ = قبل - المطلوب", () => {
  it("عشوائي ثابت (seeded) على 300 حالة", () => {
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 300; i++) {
      const n = 1 + Math.floor(rnd() * 4);
      const rows = Array.from({ length: n }, (_, k) => row(k + 1, Math.floor(rnd() * 100), 0, k === 0));
      const want = toMilli(1 + Math.floor(rnd() * 150));
      const before = totalsOf(rows).qty;
      const r = planOut(rows, want);
      if (before >= want) {
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.shares.reduce((a, x) => a + x.amount, 0)).toBe(want);
          for (const x of r.shares) expect(x.amount <= rows.find((q) => q.warehouseId === x.warehouseId)!.qty).toBe(true);
        }
      } else expect(r.ok).toBe(false);
    }
  });
});

describe("محاكاة دفتر مخزون: إجمالي الصنف = مجموع المخازن دايمًا، ومفيش سالب، والمحجوز ≤ الكمية", () => {
  it("2000 عملية عشوائية ثابتة على 3 مخازن", () => {
    let s = 987654;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const rows: BalanceRow[] = [row(1, 0, 0, true), row(2, 0), row(3, 0)];
    let total = 0;
    let reservedTotal = 0;
    for (let i = 0; i < 2000; i++) {
      const op = Math.floor(rnd() * 4);
      const amt = toMilli(1 + Math.floor(rnd() * 20));
      if (op === 0) {
        const r = rows[Math.floor(rnd() * rows.length)];
        r.qty += amt;
        total += amt;
      } else if (op === 1) {
        const p = planOut(rows, amt);
        if (p.ok) for (const sh of p.shares) { rows.find((r) => r.warehouseId === sh.warehouseId)!.qty -= sh.amount; total -= sh.amount; }
      } else if (op === 2) {
        const p = planReserve(rows, amt);
        if (p.ok) for (const sh of p.shares) { rows.find((r) => r.warehouseId === sh.warehouseId)!.reserved += sh.amount; reservedTotal += sh.amount; }
      } else {
        const p = planRelease(rows, amt);
        if (p.ok) for (const sh of p.shares) { rows.find((r) => r.warehouseId === sh.warehouseId)!.reserved -= sh.amount; reservedTotal -= sh.amount; }
      }
      const t = totalsOf(rows);
      expect(t.qty).toBe(total);
      expect(t.reserved).toBe(reservedTotal);
      for (const r of rows) { expect(r.qty >= 0).toBe(true); expect(r.reserved >= 0).toBe(true); }
    }
  });
});
