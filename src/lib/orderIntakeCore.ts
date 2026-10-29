/** @format */
// قواعد استقبال أمر الإنتاج (إنشاء أمر جديد) بدون قاعدة بيانات، عشان تتختبر لوحدها.
// النسخة المطابقة على الويب: web/src/staff/orderRules.ts (checkOrderCreate) — واختبار التطابق بيمسك أي اختلاف.

/** نفس حراس POST /production-workflow (sales_manager اتشال في الخطوة 27: هو للقراءة فقط في الإنتاج). */
export const ORDER_CREATE_ROLES = ["hr", "hr_manager", "executive_manager", "chairman"] as const;

export type OrderIntakeCode =
  | "CUSTOMER_REQUIRED"
  | "QTY_INVALID"
  | "DATE_INVALID"
  | "DATE_IN_PAST"
  | "PHONE_INVALID";

export type OrderIntakeCheck =
  | { ok: true }
  | { ok: false; code: OrderIntakeCode; message: string };

const QTY_RE = /^\d+(\.\d{1,3})?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** تاريخ اليوم بتوقيت القاهرة بصيغة YYYY-MM-DD. */
export function cairoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function isRealDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * - اسم العميل بعد التقليم مش فاضي.
 * - الكمية رقم موجب بحد أقصى 3 خانات عشرية.
 * - تاريخ التسليم تاريخ حقيقي وبصيغة YYYY-MM-DD ومش في الماضي (بتوقيت القاهرة).
 * - الموبايل (لو اتكتب) 7 أرقام على الأقل.
 */
export function checkOrderCreate(
  input: { customerName: string; qty: string; neededBy: string; customerPhone?: string | null },
  today: string = cairoToday(),
): OrderIntakeCheck {
  if (!input.customerName.trim()) {
    return { ok: false, code: "CUSTOMER_REQUIRED", message: "اسم العميل مطلوب" };
  }
  const qty = input.qty.trim();
  if (!QTY_RE.test(qty) || Number(qty) <= 0) {
    return { ok: false, code: "QTY_INVALID", message: "الكمية لازم تكون رقمًا أكبر من صفر (حتى 3 خانات عشرية)" };
  }
  const date = input.neededBy.trim();
  if (!isRealDate(date)) {
    return { ok: false, code: "DATE_INVALID", message: "تاريخ التسليم غير صحيح" };
  }
  if (date < today) {
    return { ok: false, code: "DATE_IN_PAST", message: "تاريخ التسليم لا يمكن أن يكون في الماضي" };
  }
  const phone = (input.customerPhone ?? "").trim();
  if (phone && phone.replace(/\D/g, "").length < 7) {
    return { ok: false, code: "PHONE_INVALID", message: "رقم الموبايل قصير جدًا" };
  }
  return { ok: true };
}
