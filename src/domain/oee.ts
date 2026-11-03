/** @format */
/**
 * OEE حقيقي (الخطوة 37ب) = الإتاحة × الأداء × الجودة. منطق نقي من غير قاعدة بيانات.
 *  - الإتاحة   = (الوقت المخطط − التوقف) ÷ الوقت المخطط
 *  - الأداء    = الوقت المعياري للكميات المنتجة ÷ وقت التشغيل الفعلي (محدود بـ100%)
 *  - الجودة    = الجيد ÷ (الجيد + الهالك + إعادة التشغيل)
 * أي عنصر مالوش بيانات بيرجع null، والـOEE كمان null (مانخمّنش رقم).
 */

export const STOPPAGE_REASONS = ["mechanical_failure", "electrical_failure", "material_shortage", "changeover_setup", "quality_hold", "planned_maintenance", "power_outage", "operator_break", "other"] as const;
export const isStoppageReason = (s: string) => (STOPPAGE_REASONS as readonly string[]).includes(s);

/** التوقف المخطط (صيانة دورية، استراحة) مابينقصش الوقت المخطط في بعض المعايير؛ هنا بنحسبه توقف زي أي توقف عشان الأرقام تكون متحفظة وواضحة. */
const r1 = (n: number) => Math.round(n * 1000) / 10; // نسبة مئوية بكسر واحد
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface OeeInput {
  plannedMinutes: number;
  downtimeMinutes: number;
  /** مجموع (كمية العملية × دقايق التشغيل المعيارية للوحدة)، أو null لو مفيش زمن معياري لأي عملية اتأكدت. */
  idealMinutes: number | null;
  good: number;
  scrap: number;
  rework: number;
}
export interface OeeResult {
  plannedMinutes: number;
  downtimeMinutes: number;
  runMinutes: number;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  produced: number;
}

export function calcOee(i: OeeInput): OeeResult {
  const planned = Math.max(0, i.plannedMinutes);
  const down = Math.min(Math.max(0, i.downtimeMinutes), planned);
  const run = Math.max(0, planned - down);
  const produced = r3(i.good + i.scrap + i.rework);
  const availability = planned > 0 ? run / planned : null;
  const performance = i.idealMinutes !== null && run > 0 && produced > 0 ? Math.min(1, i.idealMinutes / run) : null;
  const quality = produced > 0 ? i.good / produced : null;
  const oee = availability !== null && performance !== null && quality !== null ? availability * performance * quality : null;
  return {
    plannedMinutes: Math.round(planned),
    downtimeMinutes: Math.round(down),
    runMinutes: Math.round(run),
    availability: availability === null ? null : r1(availability),
    performance: performance === null ? null : r1(performance),
    quality: quality === null ? null : r1(quality),
    oee: oee === null ? null : r1(oee),
    produced,
  };
}

/** دقايق التوقف اللي بتقع جوّه الفترة [from, to). التوقف المفتوح بيتحسب لحد دلوقتي. */
export function overlapMinutes(startedAt: Date, endedAt: Date | null, from: Date, to: Date, now: Date): number {
  const end = endedAt ?? now;
  const a = Math.max(startedAt.getTime(), from.getTime());
  const b = Math.min(end.getTime(), to.getTime());
  return b > a ? (b - a) / 60000 : 0;
}

/** مدة توقف بالدقايق من الوقتين (تقريب لفوق، وأقل حاجة دقيقة). */
export const stoppageMinutes = (startedAt: Date, endedAt: Date) => Math.max(1, Math.ceil((endedAt.getTime() - startedAt.getTime()) / 60000));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s: string) => DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const dayNo = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);

/** عدد أيام الشغل بين تاريخين (شاملين). الجمعة إجازة افتراضيًا. */
export function workingDays(from: string, to: string, skipFriday = true): number {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return 0;
  let n = 0;
  for (let d = dayNo(from); d <= dayNo(to); d++) {
    const dow = new Date(d * 86400000).getUTCDay(); // 5 = الجمعة
    if (!(skipFriday && dow === 5)) n += 1;
  }
  return n;
}

/** بداية يوم بتوقيت القاهرة (بيراعي التوقيت الصيفي) كـDate. */
export function cairoDayStart(iso: string): Date {
  const guess = new Date(`${iso}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", hour12: false, hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asCairo = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  const offset = asCairo - guess.getTime();
  return new Date(guess.getTime() - offset);
}
export const addDaysIso = (iso: string, n: number) => new Date((dayNo(iso) + n) * 86400000).toISOString().slice(0, 10);

/** حدود التقرير: من بداية يوم from لبداية اليوم اللي بعد to (بتوقيت القاهرة). المدى محدود بسنة. */
export function reportRange(from: string, to: string): { from: Date; to: Date } | null {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from || dayNo(to) - dayNo(from) > 366) return null;
  return { from: cairoDayStart(from), to: cairoDayStart(addDaysIso(to, 1)) };
}

/** دقايق الوردية الصافية (بتعدّي منتصف الليل) — نفس منطق صفحة البيانات الأساسية. */
export function shiftNetMinutes(start: string, end: string, breakMinutes: number): number {
  const T = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!T.test(start) || !T.test(end)) return 0;
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  let span = m(end) - m(start);
  if (span <= 0) span += 1440;
  return Math.max(span - breakMinutes, 0);
}
