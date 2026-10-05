/** @format */

// Portal chat (customer <-> sales) — pure policy helpers.
//
// Everything here is deterministic and database-free so it can be unit
// tested directly (see chatPolicy.test.ts). Routes and services only call
// these helpers; they never re-implement the rules inline.

/* ============================================================
   Configuration (agreed with the product owner)
============================================================ */

export const CHAT_TIMEZONE = "Africa/Cairo";

/** السبت → الخميس، 9ص → 5م (الجمعة إجازة). 0 = الأحد … 6 = السبت */
export const CHAT_BUSINESS = {
  openDays: [6, 0, 1, 2, 3, 4] as readonly number[],
  openMinute: 9 * 60,
  closeMinute: 17 * 60,
} as const;

/** مهلة التصعيد لمدير المبيعات — بدقائق عمل فعلية (خارج الدوام لا تُحسب). */
export const CHAT_ESCALATION_BUSINESS_MINUTES = Number(
  process.env.CHAT_ESCALATION_MINUTES ?? 15,
);

/** أقل فاصل بين رسالتين رد تلقائي لنفس العميل خارج الدوام. */
export const CHAT_AUTO_REPLY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export const CHAT_MAX_BODY_LENGTH = 2000;
export const CHAT_MAX_IMAGE_BYTES = 600 * 1024; // بعد الضغط من المتصفح
export const CHAT_IMAGE_RETENTION_DAYS = 90;
export const CHAT_PAGE_SIZE = 50;

export const CHAT_AUTO_REPLY_TEXT =
  "شكرًا لتواصلك مع هايبر تك 🌙 وصلتنا رسالتك خارج ساعات العمل " +
  "(السبت – الخميس، 9 ص – 5 م بتوقيت القاهرة). سيرد عليك مسؤول حسابك " +
  "فور بدء الدوام.";

/* ============================================================
   Runtime configuration (the manager edits this from the UI)
============================================================ */

export type ChatConfig = {
  /** 0 = الأحد … 6 = السبت */
  openDays: number[];
  openMinute: number;
  closeMinute: number;
  escalationMinutes: number;
  autoReplyEnabled: boolean;
  autoReplyText: string;
  /** أيام إجازة رسمية YYYY-MM-DD (بتوقيت القاهرة) تُعامل كمغلقة */
  holidays: string[];
  /** رقم واتساب للدعم (دولي بدون +) — زر «تواصل عبر واتساب» المجاني للعميل */
  whatsappNumber: string | null;
};

export const DEFAULT_CHAT_CONFIG: ChatConfig = {
  openDays: [...CHAT_BUSINESS.openDays],
  openMinute: CHAT_BUSINESS.openMinute,
  closeMinute: CHAT_BUSINESS.closeMinute,
  escalationMinutes: CHAT_ESCALATION_BUSINESS_MINUTES,
  autoReplyEnabled: true,
  autoReplyText: CHAT_AUTO_REPLY_TEXT,
  holidays: [],
  whatsappNumber: null,
};

/** يدمج قيمًا محفوظة جزئيًا مع الافتراضي (يتحمّل بيانات قديمة/ناقصة). */
export function mergeChatConfig(saved: Partial<ChatConfig> | null | undefined): ChatConfig {
  return { ...DEFAULT_CHAT_CONFIG, ...(saved ?? {}) };
}

/** يرجع نص خطأ عربي أو null. */
export function validateChatConfig(c: ChatConfig): string | null {
  if (!c.openDays.length) return "اختر يوم عمل واحدًا على الأقل";
  if (c.openDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "أيام العمل غير صالحة";
  if (!Number.isInteger(c.openMinute) || !Number.isInteger(c.closeMinute)) return "ساعات العمل غير صالحة";
  if (c.openMinute < 0 || c.closeMinute > 24 * 60 || c.closeMinute <= c.openMinute) return "وقت الإغلاق لازم يكون بعد وقت الفتح";
  if (!Number.isInteger(c.escalationMinutes) || c.escalationMinutes < 1 || c.escalationMinutes > 24 * 60) return "مهلة التصعيد بين 1 و1440 دقيقة";
  if (c.holidays.some((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h))) return "صيغة تاريخ الإجازة YYYY-MM-DD";
  if (c.whatsappNumber && !/^\d{8,15}$/.test(c.whatsappNumber)) return "رقم واتساب: أرقام فقط بالصيغة الدولية بدون +";
  if (c.autoReplyText.length > 500) return "نص الرد التلقائي طويل";
  return null;
}

/* ============================================================
   Business hours (Africa/Cairo, DST-safe)
============================================================ */

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const cairoFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CHAT_TIMEZONE,
  hourCycle: "h23",
  weekday: "short",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

type LocalParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
};

function localParts(ms: number): LocalParts {
  const out: Record<string, string> = {};
  for (const part of cairoFormatter.formatToParts(new Date(ms))) {
    out[part.type] = part.value;
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAY_INDEX[out.weekday] ?? 0,
  };
}

function offsetMs(ms: number): number {
  const p = localParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** يحوّل وقتًا محليًا بالقاهرة إلى لحظة UTC (بالميلي ثانية). */
function cairoLocalToUtc(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
): number {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let t = guess - offsetMs(guess);
  t = guess - offsetMs(t);
  return t;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function isWithinBusinessHours(
  at: Date,
  config: ChatConfig = DEFAULT_CHAT_CONFIG,
): boolean {
  const p = localParts(at.getTime());
  if (!config.openDays.includes(p.weekday)) return false;
  if (config.holidays.includes(`${p.year}-${pad(p.month)}-${pad(p.day)}`)) return false;
  const minuteOfDay = p.hour * 60 + p.minute;
  return minuteOfDay >= config.openMinute && minuteOfDay < config.closeMinute;
}

/**
 * عدد دقائق العمل الفعلية بين لحظتين.
 * إنتقالات التوقيت الصيفي في مصر تقع بين الخميس والجمعة (الجمعة إجازة)
 * فنافذة 9–5 لا تعبر انتقالًا أبدًا، وهذا يجعل الحساب بالأيام آمنًا.
 */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  config: ChatConfig = DEFAULT_CHAT_CONFIG,
): number {
  const start = from.getTime();
  const end = to.getTime();
  if (!(end > start)) return 0;

  let total = 0;
  const first = localParts(start);
  let cursor = Date.UTC(first.year, first.month - 1, first.day);
  for (let i = 0; i < 400; i += 1) {
    const dayDate = new Date(cursor);
    const y = dayDate.getUTCFullYear();
    const m = dayDate.getUTCMonth() + 1;
    const d = dayDate.getUTCDate();
    const weekday = dayDate.getUTCDay();
    const windowStart = cairoLocalToUtc(y, m, d, config.openMinute);
    if (windowStart >= end) break;
    const isHoliday = config.holidays.includes(`${y}-${pad(m)}-${pad(d)}`);
    if (config.openDays.includes(weekday) && !isHoliday) {
      const windowEnd = cairoLocalToUtc(y, m, d, config.closeMinute);
      const overlap = Math.min(end, windowEnd) - Math.max(start, windowStart);
      if (overlap > 0) total += overlap / 60000;
    }
    cursor += 24 * 60 * 60 * 1000;
  }
  return Math.floor(total);
}

/* ============================================================
   Escalation
============================================================ */

export function isEscalationDue(input: {
  awaitingStaffSince: Date | null;
  escalatedAt: Date | null;
  now: Date;
  thresholdBusinessMinutes?: number;
  config?: ChatConfig;
}): boolean {
  if (!input.awaitingStaffSince || input.escalatedAt) return false;
  const config = input.config ?? DEFAULT_CHAT_CONFIG;
  const threshold = input.thresholdBusinessMinutes ?? config.escalationMinutes;
  return (
    businessMinutesBetween(input.awaitingStaffSince, input.now, config) >=
    threshold
  );
}

/** هل يُرسل رد تلقائي؟ خارج الدوام فقط، وبفاصل زمني بين الردود. */
export function shouldSendAutoReply(input: {
  now: Date;
  lastAutoReplyAt: Date | null;
  config?: ChatConfig;
}): boolean {
  const config = input.config ?? DEFAULT_CHAT_CONFIG;
  if (!config.autoReplyEnabled) return false;
  if (isWithinBusinessHours(input.now, config)) return false;
  if (!input.lastAutoReplyAt) return true;
  return (
    input.now.getTime() - input.lastAutoReplyAt.getTime() >=
    CHAT_AUTO_REPLY_COOLDOWN_MS
  );
}

/* ============================================================
   Staff access control
============================================================ */

/** مدير المبيعات: يرى كل شيء، يحوّل، يغلق، يخفي رسالة، يستقبل التصعيد. */
export const CHAT_MANAGER_ROLES = ["sales_manager", "chairman"] as const;
/** مراقبة إدارية: قراءة فقط، وكل فتح لمحادثة يُسجَّل في سجل التدقيق. */
export const CHAT_OBSERVER_ROLES = ["executive_manager"] as const;
/** موظفو الرد: محادثات عملائهم المعيّنين + الصندوق المشترك (غير المعيّنة). */
export const CHAT_AGENT_ROLES = [
  "online_seller",
  "offline_seller",
  "hr",
  "hr_manager",
] as const;

export const CHAT_STAFF_ROLES = [
  ...CHAT_MANAGER_ROLES,
  ...CHAT_OBSERVER_ROLES,
  ...CHAT_AGENT_ROLES,
] as const;

/** الأدوار التي يجوز تحويل المحادثة إليها (لا مراقبة بدون رد). */
export const CHAT_ASSIGNABLE_ROLES = [
  ...CHAT_MANAGER_ROLES,
  ...CHAT_AGENT_ROLES,
] as const;

export type ChatAccess = {
  canView: boolean;
  canReply: boolean;
  canManage: boolean;
  /** يجب تسجيل الدخول لهذه المحادثة في سجل التدقيق */
  mustAudit: boolean;
  /** الرد سيُسند المحادثة تلقائيًا لهذا الموظف (كانت بلا مسؤول) */
  replyClaims: boolean;
};

const NO_ACCESS: ChatAccess = {
  canView: false,
  canReply: false,
  canManage: false,
  mustAudit: false,
  replyClaims: false,
};

/**
 * وضع المستخدم في الشات. الافتراضي يُشتق من الدور، ويمكن للمدير تجاوزه
 * لكل موظف على حدة (جدول chat_staff_access) — هذا هو "من يرد على العملاء".
 *  manager  = يدير الكل ويرد ويحوّل ويغلق
 *  agent    = يرد على محادثاته + الصندوق المشترك
 *  observer = قراءة فقط (مع تدقيق)
 *  none     = لا وصول
 */
export const CHAT_MODES = ["manager", "agent", "observer", "none"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

export function defaultChatModeForRole(role: string): ChatMode {
  if ((CHAT_MANAGER_ROLES as readonly string[]).includes(role)) return "manager";
  if ((CHAT_OBSERVER_ROLES as readonly string[]).includes(role)) return "observer";
  if ((CHAT_AGENT_ROLES as readonly string[]).includes(role)) return "agent";
  return "none";
}

/** الوضع الفعلي: التجاوز الصريح (إن وُجد) يغلب الدور. */
export function effectiveChatMode(
  role: string,
  override: string | null | undefined,
): ChatMode {
  if (override && (CHAT_MODES as readonly string[]).includes(override)) {
    return override as ChatMode;
  }
  return defaultChatModeForRole(role);
}

export function resolveChatAccessByMode(
  mode: ChatMode,
  userId: number,
  effectiveHandlerUserId: number | null,
): ChatAccess {
  if (mode === "manager") {
    return {
      canView: true,
      canReply: true,
      canManage: true,
      mustAudit: false,
      replyClaims: false,
    };
  }
  if (mode === "observer") {
    return {
      canView: true,
      canReply: false,
      canManage: false,
      mustAudit: true,
      replyClaims: false,
    };
  }
  if (mode === "agent") {
    const mine = effectiveHandlerUserId === userId;
    const pool = effectiveHandlerUserId === null;
    if (!mine && !pool) return NO_ACCESS;
    return {
      canView: true,
      canReply: true,
      canManage: false,
      mustAudit: false,
      replyClaims: pool,
    };
  }
  return NO_ACCESS;
}

/** توافق مع الاستدعاءات القديمة (بدون تجاوز). */
export function resolveChatAccess(
  role: string,
  userId: number,
  effectiveHandlerUserId: number | null,
  override?: string | null,
): ChatAccess {
  return resolveChatAccessByMode(
    effectiveChatMode(role, override),
    userId,
    effectiveHandlerUserId,
  );
}

/* ============================================================
   Message validation
============================================================ */

export function normalizeChatBody(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

export function chatPreview(body: string, hasImage: boolean): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (!text) return hasImage ? "📷 صورة" : "";
  const prefix = hasImage ? "📷 " : "";
  const clipped = text.length > 100 ? `${text.slice(0, 100)}…` : text;
  return `${prefix}${clipped}`;
}

export type ChatImageMime = "image/png" | "image/jpeg" | "image/webp";

/** نتحقق من البايتات الفعلية — لا نثق في ترويسة data URL ولا امتداد الملف. */
export function detectImageMime(bytes: Uint8Array): ChatImageMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "image/webp";
  }
  return null;
}

export type ParsedChatImage = {
  mime: ChatImageMime;
  bytes: Buffer;
};

/**
 * يفكّ data URL ويتحقق منها. يرمي خطأ بحالة 400 ورسالة عربية مفهومة.
 */
export function parseChatImageDataUrl(dataUrl: string): ParsedChatImage {
  const fail = (message: string) =>
    Object.assign(new Error(message), { status: 400 });

  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(
    dataUrl,
  );
  if (!match) throw fail("الصورة لازم تكون png أو jpg أو webp");

  const approx = Math.floor((match[2].length * 3) / 4);
  if (approx > CHAT_MAX_IMAGE_BYTES * 1.05) {
    throw fail("حجم الصورة كبير — الحد الأقصى 600 كيلوبايت بعد الضغط");
  }
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > CHAT_MAX_IMAGE_BYTES) {
    throw fail("حجم الصورة كبير — الحد الأقصى 600 كيلوبايت بعد الضغط");
  }
  const mime = detectImageMime(bytes);
  if (!mime) throw fail("الملف ليس صورة صالحة");
  return { mime, bytes };
}

/* ============================================================
   Delivery / read status (derived — no per-message UPDATE needed)
============================================================ */

export type ChatDeliveryStatus = "sent" | "delivered" | "read";

export function deriveDeliveryStatus(
  messageId: number,
  counterpartDeliveredUpTo: number,
  counterpartReadUpTo: number,
): ChatDeliveryStatus {
  if (messageId <= counterpartReadUpTo) return "read";
  if (messageId <= counterpartDeliveredUpTo) return "delivered";
  return "sent";
}

/* ============================================================
   Context references a message may carry
============================================================ */

export const CHAT_CONTEXT_TYPES = ["order", "product", "price_inquiry"] as const;
export type ChatContextType = (typeof CHAT_CONTEXT_TYPES)[number];

export const CHAT_TOPICS = [
  "price",
  "order",
  "product",
  "complaint",
  "other",
] as const;
export type ChatTopic = (typeof CHAT_TOPICS)[number];
