/** @format */
/**
 * قناة الفاتورة: «website» = أونلاين (بتتعمل تلقائيًا من طلبات بوابة العملاء)، «direct» = أوفلاين (يدوية من البائع).
 *
 * القواعد في مكان واحد عشان صفحتين (أونلاين/أوفلاين) على نفس الجدول ما يتلخبطوش تاني:
 *  - الفاتورة اليدوية دايمًا «direct». «website» بيتحط من مسار البوابة بس.
 *  - بائع الأونلاين ما بيعملش فواتير يدوية؛ بيشوف كل فواتير الأونلاين ويتابعها.
 *  - بائع الأوفلاين بيشوف فواتيره هو بس (زي ما كان).
 *  - باقي الأدوار بتختار القناة بالفلتر (أو تشوف الكل).
 */
export type SalesChannel = "website" | "direct";

export const SALES_CHANNELS: readonly SalesChannel[] = ["website", "direct"];

/** علامة الفواتير اللي بتتعمل من البوابة (للترحيل القديم: فواتير قبل وجود القناة الصحيحة). */
export const PORTAL_INVOICE_NOTE_PREFIX = "تم إنشاؤها تلقائيًا من طلب بوابة العملاء";

export function parseChannel(v: unknown): SalesChannel | undefined {
  return typeof v === "string" && (SALES_CHANNELS as readonly string[]).includes(v) ? (v as SalesChannel) : undefined;
}

export interface ListScope {
  channel?: SalesChannel;
  createdById?: number;
}

export function listScope(role: string, userId: number, requested?: unknown): ListScope {
  if (role === "online_seller") return { channel: "website" };
  if (role === "offline_seller") return { channel: "direct", createdById: userId };
  return { channel: parseChannel(requested) };
}

/** القناة المسموحة للفاتورة اليدوية، أو error برسالة عربية واضحة. */
export function manualCreateChannel(role: string, requested?: unknown): SalesChannel {
  if (role === "online_seller") {
    throw Object.assign(new Error("فواتير الأونلاين بتتعمل تلقائيًا من طلبات بوابة العملاء، ومينفعش تتعمل يدويًا."), { status: 403, code: "ONLINE_MANUAL_CREATE_FORBIDDEN" });
  }
  if (requested === "website") {
    throw Object.assign(new Error("الفاتورة اليدوية بتتسجّل أوفلاين. فواتير الأونلاين بتيجي تلقائيًا من البوابة."), { status: 400, code: "ONLINE_MANUAL_CREATE_FORBIDDEN" });
  }
  return "direct";
}
