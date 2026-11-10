/** وعود التسليم المثبّتة (44ب): منطق العرض في الواجهة. الحساب والحفظ في السيرفر. */
export interface PromiseRow {
  id: number;
  caseId: number;
  promisedDate: string;
  confidencePercent: number | null;
  method: string;
  reason: string | null;
  createdAt: string;
}
export type Standing = "within" | "over" | "none";
export interface PromiseSummary {
  caseId: number;
  caseNumber: string;
  customer: string | null;
  dueDate: string | null;
  first: PromiseRow;
  current: PromiseRow;
  revisions: number;
  standing: Standing;
}

const DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** موجب = المحسوب دلوقتي أبعد من المثبّت (الوعد المثبّت بقى ضيّق). */
export function driftDays(committed: string, live: string): number {
  return Math.round((parse(live) - parse(committed)) / DAY);
}
export type DriftState = "same" | "later" | "earlier";
export const driftState = (n: number): DriftState => (n > 0 ? "later" : n < 0 ? "earlier" : "same");

export const standingTone = (s: Standing): "success" | "danger" | "neutral" => (s === "within" ? "success" : s === "over" ? "danger" : "neutral");
/** التعديل بيحتاج سبب 3 حروف على الأقل؛ التثبيت الأول لأ. */
export const reasonNeeded = (hasPrevious: boolean) => hasPrevious;
export const reasonOk = (reason: string) => reason.trim().length >= 3;
/** الأقرب وعدًا أولًا، والمتجاوز للموعد الأول في نفس التاريخ. */
export function sortSummaries(rows: readonly PromiseSummary[]): PromiseSummary[] {
  const rank = (s: PromiseSummary) => (s.standing === "over" ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.current.promisedDate.localeCompare(b.current.promisedDate));
}
