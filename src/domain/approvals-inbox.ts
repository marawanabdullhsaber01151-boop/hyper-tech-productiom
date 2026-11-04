/** @format */
// صندوق الاعتمادات (الخطوة 39أ): ساعات العمل، مهلة الرد (SLA)، قاعدة «من أنشأ لا يعتمد نفسه»، ومحاكي الأثر. نقي من غير قاعدة بيانات.

/** ساعات العمل الافتراضية بتوقيت القاهرة: 9 ص – 5 م، الجمعة إجازة. (هتتعدّل من مركز الإعدادات في الخطوة 40.) */
export const BUSINESS_HOURS = { startHour: 9, endHour: 17, offDay: 5 } as const;
/** المهلة: 4 ساعات عمل = 240 دقيقة. وبنقول «قرب ينتهي» عند 75%. */
export const SLA_WORKING_MINUTES = 240;
export const SLA_SOON_AT = 0.75;
const MAX_SPAN_DAYS = 60;

const CAIRO = "Africa/Cairo";
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: CAIRO, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

function cairoParts(d: Date) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute) };
}

/** اللحظة (UTC) اللي الساعة فيها hour:00 بتوقيت القاهرة في اليوم y-m-d (بيراعي التوقيت الصيفي). */
export function cairoInstant(y: number, m: number, d: number, hour: number): Date {
  const naive = Date.UTC(y, m - 1, d, hour, 0);
  let t = naive;
  for (let i = 0; i < 2; i++) {
    const c = cairoParts(new Date(t));
    t += naive - Date.UTC(c.y, c.m - 1, c.d, c.h, c.min);
  }
  return new Date(t);
}

/** دقايق العمل الفعلية بين لحظتين (من غير الجمعة وخارج 9–5). بيرجّع 0 لو الترتيب معكوس. */
export function workingMinutesBetween(from: Date, to: Date): number {
  if (!(to.getTime() > from.getTime())) return 0;
  const a = cairoParts(from);
  const b = cairoParts(to);
  let day = Date.UTC(a.y, a.m - 1, a.d);
  const last = Date.UTC(b.y, b.m - 1, b.d);
  if ((last - day) / 86400000 > MAX_SPAN_DAYS) day = last - MAX_SPAN_DAYS * 86400000;
  let total = 0;
  for (; day <= last; day += 86400000) {
    const dt = new Date(day);
    if (dt.getUTCDay() === BUSINESS_HOURS.offDay) continue;
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    const start = Math.max(cairoInstant(y, m, d, BUSINESS_HOURS.startHour).getTime(), from.getTime());
    const end = Math.min(cairoInstant(y, m, d, BUSINESS_HOURS.endHour).getTime(), to.getTime());
    if (end > start) total += (end - start) / 60000;
  }
  return Math.floor(total);
}

export type SlaState = "ok" | "due_soon" | "overdue";
export function slaState(waitedWorkingMinutes: number): SlaState {
  if (waitedWorkingMinutes >= SLA_WORKING_MINUTES) return "overdue";
  return waitedWorkingMinutes >= SLA_WORKING_MINUTES * SLA_SOON_AT ? "due_soon" : "ok";
}

export interface DecideInput {
  userId: number;
  requestedBy: number;
  /** الأدوار الفعلية للمستخدم (دوره + اللي اتفوّض فيه). */
  roles: readonly string[];
  /** الأدوار المعتمدة للخطوة الحالية. */
  stepRoles: readonly string[];
  /** لو مفيش أي موظف نشط تاني بدور معتمد للخطوة غير صاحب الطلب. */
  requesterIsSoleApprover: boolean;
}
export type DecideBlock = "role" | "self";
export interface DecideVerdict { canApprove: boolean; canReject: boolean; block: DecideBlock | null; selfException: boolean }

/**
 * الصلاحية: لازم دور معتمد للخطوة. ومن أنشأ الطلب ما يعتمدوش (بيقدر يرفضه = يسحبه)،
 * إلا لو هو الوحيد النشط اللي دوره معتمد للخطوة (وإلا الطلب يقف للأبد): بيعدّي لكن بعلامة استثناء في التدقيق.
 */
export const SELF_APPROVAL_EXEMPT: readonly string[] = ["chairman", "executive_manager"];

export function decideVerdict(i: DecideInput): DecideVerdict {
  const hasRole = i.stepRoles.some((r) => i.roles.includes(r));
  if (!hasRole) return { canApprove: false, canReject: false, block: "role", selfException: false };
  if (i.userId === i.requestedBy) {
    // الرئيس والمدير التنفيذي معفيين من منع اعتماد النفس (قرار المالك)
    if (i.roles.some((r) => SELF_APPROVAL_EXEMPT.includes(r))) return { canApprove: true, canReject: true, block: null, selfException: false };
    if (i.requesterIsSoleApprover) return { canApprove: true, canReject: true, block: null, selfException: true };
    return { canApprove: false, canReject: true, block: "self", selfException: false };
  }
  return { canApprove: true, canReject: true, block: null, selfException: false };
}

export const REJECT_NOTE_MIN = 3;
/** الرفض لازم سبب (كلمتين على الأقل تقريبًا)؛ الاعتماد الملاحظة اختيارية. */
export const rejectNoteError = (note: string | null | undefined): boolean => (note ?? "").trim().length < REJECT_NOTE_MIN;

const STATUS_AR: Record<string, string> = { draft: "مسودة", confirmed: "مؤكد", shipped: "تم الشحن", paid: "مدفوع", delivered: "تم التسليم" };
export const statusLabel = (s: string) => STATUS_AR[s] ?? s;

export interface ImpactInput {
  resourceType: string;
  amount: number;
  metadata: unknown;
  nextStepRoles: readonly string[] | null;
  /** عدد بنود أمر البيع (لو معروف). */
  itemCount?: number | null;
}
export interface Impact { approve: string[]; reject: string[] }

const meta = (m: unknown, k: string): string | null => (m && typeof m === "object" && typeof (m as Record<string, unknown>)[k] === "string" ? ((m as Record<string, unknown>)[k] as string) : null);

/** «لو اعتمدت إيه اللي هيحصل، ولو رفضت إيه اللي هيحصل» بصياغة بسيطة. مبني على نفس قواعد المسار الفعلي في السيرفر. */
export function describeImpact(i: ImpactInput): Impact {
  const next = i.nextStepRoles?.length ? i.nextStepRoles : null;
  if (i.resourceType === "sales_order") {
    const original = meta(i.metadata, "originalStatus") ?? "confirmed";
    const n = i.itemCount ?? null;
    const items = n === null ? "بنود الأمر" : `${n} بند`;
    const approve = next
      ? ["الطلب بيتحوّل لخطوة اعتماد أعلى قبل ما يتنفذ.", "الأمر بيفضل «بانتظار الاعتماد» لحد القرار الأخير."]
      : [`الأمر بيرجع لحالته المطلوبة «${statusLabel(original)}» وبيكمل مساره.`];
    const reject = ["الأمر بيتلغي ومابيكملش."];
    if (original === "confirmed") reject.push(`الحجز المخزني على ${items} بيتفك.`);
    else if (original === "shipped" || original === "paid") reject.push(`كميات ${items} بترجع للمخزون.`);
    return { approve, reject };
  }
  if (i.resourceType === "production_cost_entry") {
    return {
      approve: next ? ["التكلفة بتتحوّل لخطوة اعتماد أعلى."] : ["التكلفة بتتعتمد وبتدخل في حساب أمر الإنتاج."],
      reject: ["التكلفة بتتسجّل «مرفوضة» ومابتدخلش في حساب أمر الإنتاج."],
    };
  }
  return {
    approve: next ? ["الطلب بيتحوّل لخطوة اعتماد أعلى."] : ["الطلب بيتعلّم «معتمد» وبيكمل العملية المرتبطة بيه."],
    reject: ["الطلب بيتعلّم «مرفوض» والعملية المرتبطة بيه ماتكملش."],
  };
}
