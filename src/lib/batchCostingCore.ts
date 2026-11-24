/** @format */
// التكلفة المعيارية والانحرافات وربحية الدفعة (54): القواعد الصافية (من غير قاعدة بيانات). كل الفلوس بالقروش (bigint) والكميات بالألف (milli).
//
// التعريفات (موثّقة في ADR 0044):
//   المعياري لدفعة = (المعيار لدفعة بحجم output_qty) × الكمية المنتجة ÷ output_qty. الخامات من مكونات الوصفة، والباقي من معيار الوصفة.
//   الفعلي = قيود التكلفة المعتمدة: المباشرة على الدفعة + نصيب الدفعة من قيود الأمر غير المنسوبة لدفعة (بالتناسب مع الكمية المنتجة).
//   الانحراف = الفعلي − المعياري (موجب = زيادة في التكلفة = غير مفضّل، سالب = توفير).
//   فاقد الكفاءة = (المتوقع سليمًا − السليم الفعلي) × تكلفة الوحدة المعيارية. بيانات تحليلية مش بتتجمع في الانحراف الإجمالي.
//   الربحية = سعر البيع × الكمية السليمة − التكلفة الفعلية.
import { z } from "zod";
import { lineTotalCents } from "./money";

export const COST_TYPES = ["material", "labor", "machine", "energy", "overhead", "rework", "scrap"] as const;
export type CostType = (typeof COST_TYPES)[number];

/** رقم عشري كنص (ممكن سالب) ← أصغر وحدة (scale خانات). بيرفض أي حاجة مش رقم. */
export function parseScaled(text: string | number, digits: number): bigint {
  const s = String(text).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`رقم غير صالح: ${s}`);
  const frac = (m[3] ?? "").padEnd(digits + 1, "0");
  const keep = frac.slice(0, digits);
  let v = BigInt(m[2]!) * 10n ** BigInt(digits) + BigInt(keep || "0");
  if ((frac[digits] ?? "0") >= "5") v += 1n;
  return m[1] === "-" ? -v : v;
}
export const parseCents = (t: string | number): bigint => parseScaled(t, 2);
export const parseMilli = (t: string | number): bigint => parseScaled(t, 3);

/** قروش ← نص «0.00» بإشارة آمنة للسالب. */
export function centsText(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}
export function milliText(q: bigint): string {
  const neg = q < 0n;
  const a = neg ? -q : q;
  return `${neg ? "-" : ""}${a / 1000n}.${(a % 1000n).toString().padStart(3, "0")}`;
}

/** قسمة بتقريب نصف بعيدًا عن الصفر (تشتغل مع السالب). */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("قسمة على صفر");
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return neg ? -q : q;
}

/* ---------------- المعيار ---------------- */
export interface RecipeItemLite { qty: string; unitCost: string }
export interface StandardInput {
  outputQtyMilli: bigint;
  materialPerBatchCents: bigint;
  laborCents: bigint;
  machineCents: bigint;
  energyCents: bigint;
  overheadCents: bigint;
  yieldBp: bigint; // 10000 = 100%
}

/** خامات الدفعة المعيارية من مكونات الوصفة (الكمية × تكلفة الوحدة، كل سطر يتقرّب مرة). */
export function materialPerBatch(items: readonly RecipeItemLite[]): bigint {
  return items.reduce((s, i) => s + lineTotalCents(i.qty, i.unitCost), 0n);
}

export interface Bucket5 { material: bigint; labor: bigint; machine: bigint; energy: bigint; overhead: bigint }
export const sum5 = (b: Bucket5): bigint => b.material + b.labor + b.machine + b.energy + b.overhead;

/** المعياري للكمية المنتجة. */
export function standardFor(s: StandardInput, producedMilli: bigint): Bucket5 {
  if (s.outputQtyMilli <= 0n) throw new Error("كمية الوصفة لازم تكون أكبر من صفر");
  const f = (perBatch: bigint) => divRound(perBatch * producedMilli, s.outputQtyMilli);
  return { material: f(s.materialPerBatchCents), labor: f(s.laborCents), machine: f(s.machineCents), energy: f(s.energyCents), overhead: f(s.overheadCents) };
}

/* ---------------- الفعلي ---------------- */
export interface CostEntryLite { costType: string; amountCents: bigint; batchId: number | null }
export interface BatchLite { id: number; producedMilli: bigint }
export interface Actual extends Bucket5 { waste: bigint }

const emptyActual = (): Actual => ({ material: 0n, labor: 0n, machine: 0n, energy: 0n, overhead: 0n, waste: 0n });
const bucketKey = (t: string): keyof Actual | null =>
  t === "material" || t === "labor" || t === "machine" || t === "energy" || t === "overhead" ? t : t === "rework" || t === "scrap" ? "waste" : null;

/**
 * الفعلي لدفعة: قيودها المباشرة + نصيبها من قيود الأمر غير المنسوبة (batchId = null) بنسبة الكمية المنتجة بين دفعات الأمر.
 * لو مفيش كمية منتجة في أي دفعة بنقسم بالتساوي. نوع قيد مش معروف بيتجاهل (مش بيتحسب).
 */
export function actualFor(entries: readonly CostEntryLite[], batchId: number, orderBatches: readonly BatchLite[]): Actual {
  const out = emptyActual();
  const totalProduced = orderBatches.reduce((s, b) => s + b.producedMilli, 0n);
  const me = orderBatches.find((b) => b.id === batchId);
  for (const e of entries) {
    const k = bucketKey(e.costType);
    if (!k) continue;
    if (e.batchId === batchId) out[k] += e.amountCents;
    else if (e.batchId === null && me) {
      out[k] += totalProduced > 0n ? divRound(e.amountCents * me.producedMilli, totalProduced) : divRound(e.amountCents, BigInt(orderBatches.length));
    }
  }
  return out;
}
export const actualTotal = (a: Actual): bigint => sum5(a) + a.waste;

/* ---------------- سعر البيع ---------------- */
export type PriceSource = "sales_line" | "single_line" | "recipe_reference";
export interface SalesLineLite { description: string; qty: string; unitPrice: string }
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** سعر الوحدة للربحية: سطور أمر البيع بنفس اسم المنتج (متوسط مرجّح بالكمية) ← لو سطر واحد بس ← سعر الوصفة المرجعي ← مفيش. */
export function pickUnitPrice(productName: string, lines: readonly SalesLineLite[], recipeReferencePrice: string | null): { priceCents: bigint; source: PriceSource } | null {
  const avg = (ls: readonly SalesLineLite[]): bigint | null => {
    let q = 0n;
    let v = 0n;
    for (const l of ls) {
      const qm = parseMilli(l.qty);
      q += qm;
      v += qm * parseCents(l.unitPrice);
    }
    return q > 0n ? divRound(v, q) : null;
  };
  const same = lines.filter((l) => norm(l.description) === norm(productName));
  const a = same.length ? avg(same) : null;
  if (a !== null) return { priceCents: a, source: "sales_line" };
  if (lines.length === 1) {
    const one = avg(lines);
    if (one !== null) return { priceCents: one, source: "single_line" };
  }
  if (recipeReferencePrice !== null && recipeReferencePrice !== "") {
    const r = parseCents(recipeReferencePrice);
    if (r > 0n) return { priceCents: r, source: "recipe_reference" };
  }
  return null;
}

/* ---------------- الكشف ---------------- */
export interface SheetInput {
  standard: StandardInput | null; // null = الوصفة مالهاش معيار/مش موجودة: كل المعياري صفر
  recipeMissing: boolean;
  producedMilli: bigint;
  acceptedMilli: bigint;
  scrapMilli: bigint;
  reworkMilli: bigint;
  actual: Actual;
  price: { priceCents: bigint; source: PriceSource } | null;
}
export type SheetWarning = "NO_RECIPE" | "NO_STANDARD" | "NOTHING_PRODUCED" | "NO_ACCEPTED" | "NO_PRICE";
export interface Sheet {
  std: Bucket5;
  stdTotal: bigint;
  act: Actual;
  actTotal: bigint;
  variance: Bucket5 & { waste: bigint; total: bigint };
  efficiencyLoss: bigint;
  yieldActualBp: bigint | null;
  unitCostCents: bigint | null;
  unitPriceCents: bigint | null;
  priceSource: PriceSource | null;
  revenueCents: bigint | null;
  profitCents: bigint | null;
  marginBp: bigint | null;
  warnings: SheetWarning[];
}

export function computeSheet(i: SheetInput): Sheet {
  const warnings: SheetWarning[] = [];
  if (i.recipeMissing) warnings.push("NO_RECIPE");
  else if (!i.standard) warnings.push("NO_STANDARD");
  if (i.producedMilli <= 0n) warnings.push("NOTHING_PRODUCED");
  else if (i.acceptedMilli <= 0n) warnings.push("NO_ACCEPTED");
  const std: Bucket5 = i.standard ? standardFor(i.standard, i.producedMilli) : { material: 0n, labor: 0n, machine: 0n, energy: 0n, overhead: 0n };
  const stdTotal = sum5(std);
  const act = i.actual;
  const total = actualTotal(act);
  const variance = {
    material: act.material - std.material,
    labor: act.labor - std.labor,
    machine: act.machine - std.machine,
    energy: act.energy - std.energy,
    overhead: act.overhead - std.overhead,
    waste: act.waste,
    total: total - stdTotal,
  };
  let efficiencyLoss = 0n;
  if (i.standard && i.producedMilli > 0n) {
    const expected = divRound(i.producedMilli * i.standard.yieldBp, 10000n);
    efficiencyLoss = divRound(stdTotal * (expected - i.acceptedMilli), i.producedMilli);
  }
  const yieldActualBp = i.producedMilli > 0n ? divRound(i.acceptedMilli * 10000n, i.producedMilli) : null;
  const unitCostCents = i.acceptedMilli > 0n ? divRound(total * 1000n, i.acceptedMilli) : null;
  let revenueCents: bigint | null = null;
  let profitCents: bigint | null = null;
  let marginBp: bigint | null = null;
  if (i.price && i.acceptedMilli > 0n) {
    revenueCents = lineTotalCents(milliText(i.acceptedMilli), centsText(i.price.priceCents));
    profitCents = revenueCents - total;
    marginBp = revenueCents > 0n ? divRound(profitCents * 10000n, revenueCents) : null;
  } else if (!i.price) warnings.push("NO_PRICE");
  return {
    std, stdTotal, act, actTotal: total, variance, efficiencyLoss, yieldActualBp, unitCostCents,
    unitPriceCents: i.price?.priceCents ?? null, priceSource: i.price?.source ?? null, revenueCents, profitCents, marginBp, warnings,
  };
}

/** حالة الانحراف للعرض: توفير / على المعيار / زيادة (بحد تسامح بالقروش). */
export function varianceTone(c: bigint, toleranceCents = 0n): "favorable" | "neutral" | "unfavorable" {
  if (c > toleranceCents) return "unfavorable";
  if (c < -toleranceCents) return "favorable";
  return "neutral";
}

/** نسبة بالـbasis points ← نص «12.34». */
export function bpText(bp: bigint): string {
  const neg = bp < 0n;
  const a = neg ? -bp : bp;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}

/* ---------------- مدخلات المعيار من الـAPI ---------------- */
const moneyStr = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, "المبلغ لازم يكون رقم غير سالب بحد أقصى خانتين");
export const standardBodySchema = z.object({
  labor: moneyStr,
  machine: moneyStr,
  energy: moneyStr,
  overhead: moneyStr,
  yieldPercent: z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "النسبة لازم تكون رقم بحد أقصى خانتين").refine((v) => parseScaled(v, 2) > 0n && parseScaled(v, 2) <= 10000n, "النسبة من 1 لـ 100"),
  reason: z.string().trim().min(3, "اكتب سبب التغيير").max(300),
});
export const SHEET_STATUSES = ["draft", "final"] as const;
