/** @format */
/**
 * بيحوّل صف في سجل التدقيق لجملة عربي عادي: مين عمل إيه، وامتى (لحد الدقيقة).
 * الصف الأصلي ما بيتغيّرش؛ ده بس شكل العرض.
 */

export interface AuditRowLike {
  id?: number;
  actionKey: string;
  resourceType: string;
  resourceId: number | null;
  actorName: string | null;
  decision?: string | null;
  reason?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  createdAt: Date | string;
}

/** أسماء بنجيبها من القاعدة قبل ما نكتب الجملة (شركة/موظف…). */
export interface AuditNames {
  companies?: Map<number, string>;
  applications?: Map<number, string>;
}

const CAIRO = "Africa/Cairo";

/** 2026/10/12 08:13 ص — بتوقيت القاهرة، لحد الدقيقة. */
export function formatAuditTime(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: CAIRO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const h24 = Number(p.hour) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${p.year}/${p.month}/${p.day} ${String(h12).padStart(2, "0")}:${p.minute} ${h24 < 12 ? "ص" : "م"}`;
}

const SECTIONS: Record<string, string> = {
  "portal-companies": "شركات البوابة",
  "portal-customers": "عملاء البوابة",
  "portal-admin": "إعدادات البوابة",
  "portal-applications": "طلبات الانضمام",
  "portal-activation-requests": "طلبات التفعيل",
  "portal-outbox": "رسائل البوابة",
  "portal-settings": "إعدادات البوابة",
  portal: "بوابة العملاء",
  chat: "المحادثات",
  auth: "الدخول والحساب",
  foundation: "بيانات الأساس",
  engineering: "الهندسة",
  planning: "التخطيط",
  governance: "الحوكمة",
  operations: "العمليات",
  "operations-control": "التحكم في العمليات",
  state: "حالة النظام",
  sales: "المبيعات",
  contacts: "جهات الاتصال",
  inventory: "المخزون",
  production: "الإنتاج",
  "production-workflow": "مسار الإنتاج",
  quality: "الجودة",
  hr: "الموارد البشرية",
  users: "المستخدمين",
};

const BULK: Record<string, string> = {
  assignSales: "عيّن مسؤول مبيعات",
  segment: "غيّر تصنيف",
  status: "غيّر حالة",
};

const METHOD_VERB: Record<string, string> = { post: "أضاف أو نفّذ", put: "عدّل", patch: "عدّل", delete: "مسح" };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function pick(o: unknown, ...path: string[]): unknown {
  let cur: any = o;
  for (const k of path) cur = cur && typeof cur === "object" ? cur[k] : undefined;
  return cur;
}

/** جملة قصيرة بالعربي لحدث واحد. */
export function describeAudit(row: AuditRowLike, names: AuditNames = {}): string {
  const who = str(row.actorName) ?? "النظام";
  const id = row.resourceId;
  const company = id != null ? names.companies?.get(id) : undefined;
  const companyText = company ? `شركة «${company}»` : id != null ? `الشركة رقم ${id}` : "الشركة";
  const appName = str(pick(row.afterData, "application", "companyName")) ?? str(pick(row.afterData, "companyName")) ?? str(pick(row.beforeData, "companyName")) ?? (id != null ? names.applications?.get(id) : undefined);
  const appText = appName ? `طلب انضمام «${appName}»` : id != null ? `طلب الانضمام رقم ${id}` : "طلب انضمام";
  const reason = str(row.reason);
  const withReason = (s: string) => (reason ? `${s} (السبب: ${reason})` : s);
  const key = row.actionKey;

  const exact: Record<string, string> = {
    "portal.application.approved": `${who} وافق على ${appText}`,
    "portal.application.rejected": withReason(`${who} رفض ${appText}`),
    "portal.application.needs_info": withReason(`${who} طلب معلومات إضافية في ${appText}`),
    "portal.application.update": `${who} عدّل بيانات ${appText}`,
    "portal.application.city.update": `${who} غيّر محافظة ${appText}`,
    "portal.customer.activation_link.issued": `${who} أصدر رابط تفعيل لـ${companyText}`,
    "portal.customer.assigned_sales.update": `${who} غيّر مسؤول المبيعات لـ${companyText}`,
    "portal.customer.city.update": `${who} غيّر محافظة ${companyText}`,
    "portal.customer.delete": `${who} مسح ${companyText}`,
    "portal.customer.minimumOrder.update": `${who} غيّر أقل كمية للطلب لـ${companyText}`,
    "portal.customer.password.reset": `${who} عمل كلمة سر جديدة لـ${companyText}`,
    "portal.customer.password_activated": `صاحب ${companyText} فعّل حسابه واختار كلمة سر`,
    "portal.customer.password_changed": `صاحب ${companyText} غيّر كلمة السر`,
    "portal.customer.password_reset_otp_requested": `${companyText} طلب كود لاستعادة كلمة السر`,
    "portal.customer.password_reset_otp_verified": `${companyText} أكّد كود استعادة كلمة السر`,
    "portal.customer.segment.update": `${who} غيّر تصنيف ${companyText}`,
    "portal.admin_code.issued": `${who} أصدر كود إدارة لـ${companyText}`,
    "portal.activation_request.confirmed": `${who} قبل طلب تفعيل`,
    "portal.activation_request.rejected": withReason(`${who} رفض طلب تفعيل`),
    "portal.activation_request.closed": withReason(`${who} قفل طلب تفعيل من غير تنفيذ`),
    "portal.activation_request.resent": `${who} بعت رابط تفعيل تاني لطلب تفعيل سبق تأكيده`,
    "portal.session.revoked": `${who} قفل جلسة دخول على البوابة`,
    "portal.sessions.other_sessions_revoked": `${who} قفل باقي جلسات الدخول`,
    "portal_orders.override": `${who} استثنى قاعدة في طلب من طلبات البوابة`,
    "auth.2fa.enabled": `${who} شغّل التحقق بخطوتين`,
    "auth.2fa.disabled": `${who} قفل التحقق بخطوتين`,
    "auth.2fa.backup_codes_regenerated": `${who} عمل أكواد احتياطية جديدة`,
    "auth.login.blocked_locked": `${who} حاول يدخل والحساب كان مقفول مؤقتًا`,
    "auth.login.password_ok_awaiting_totp": `${who} كتب كلمة السر صح وبيستنى كود التحقق`,
    "auth.login.totp_backup_code_used": `${who} دخل بكود احتياطي`,
    "auth.login.totp_failed": `${who} كتب كود تحقق غلط`,
    "auth.session.auto_revoke": `النظام قفل جلسة ${who} تلقائيًا`,
    "chat.hide_message": `${who} أخفى رسالة في المحادثات`,
    "chat.settings": `${who} عدّل إعدادات المحادثات`,
    "chat.staff_access": `${who} عدّل مين يشوف المحادثات`,
    "chat.view": `${who} فتح محادثة`,
    "contacts.create": `${who} أضاف جهة اتصال جديدة`,
    "governance.manageDelegations": `${who} عدّل تفويض صلاحيات`,
    "governance.managePolicies": `${who} عدّل سياسة اعتماد`,
    "operations.case.received": `${who} استلم حالة تشغيل`,
    "operations.case.salesClarificationRequested": `${who} طلب توضيح من المبيعات على حالة تشغيل`,
    "operations.case.validationStarted": `${who} بدأ مراجعة حالة تشغيل`,
    "operations.case.validationCompleted": `${who} خلّص مراجعة حالة تشغيل`,
    "operations.case.viewed": `${who} فتح حالة تشغيل`,
    "operations.exception.resolve": `${who} حلّ استثناء في التشغيل`,
    "operations.purchaseRequisition.confirm": `${who} أكّد طلب شراء`,
    "production_workflow.create": `${who} فتح أمر إنتاج`,
    "production_request.convert": `${who} حوّل طلب إنتاج لأمر`,
    "sales.create": `${who} عمل أمر بيع جديد`,
    "sales.edit": `${who} عدّل أمر بيع`,
    "sales.approve": `${who} اعتمد أمر بيع`,
    "sales.delete": `${who} مسح أمر بيع`,
    "sales.price_override": `${who} غيّر سعر في أمر بيع`,
    "sales.manual_price_override": `${who} كتب سعر يدوي في أمر بيع`,
  };
  let text: string | undefined = exact[key];

  if (!text && key.startsWith("portal.companies.bulk.")) {
    const action = key.slice("portal.companies.bulk.".length);
    text = `${who} ${BULK[action] ?? "نفّذ إجراء"} لمجموعة شركات في نفس الوقت`;
  }

  if (!text) {
    const m = key.match(/^(post|put|patch|delete) (\/\S*)$/);
    if (m) {
      const method = m[1]!;
      const path = m[2]!.replace(/^\/api\/v\d+/, "");
      text = describePath(method, path, who, companyText, appText);
    }
  }
  if (!text) text = `${who} نفّذ «${key}»`;
  if (row.decision === "rejected" || /^HTTP \d+/.test(reason ?? "")) text += " — ماتنفّذش";
  return text;
}

function describePath(method: string, path: string, who: string, companyText: string, appText: string): string | undefined {
  const rules: Array<[RegExp, string]> = [
    [/^\/portal-admin\/applications\/\d+\/approve$/, `${who} وافق على ${appText}`],
    [/^\/portal-admin\/applications\/\d+\/reject$/, `${who} رفض ${appText}`],
    [/^\/portal-admin\/applications\/\d+\/request-info$/, `${who} طلب معلومات إضافية في ${appText}`],
    [/^\/portal-admin\/applications\/\d+$/, `${who} عدّل بيانات ${appText} أو عيّن مراجع`],
    [/^\/portal-admin\/activation-requests\/\d+\/close$/, `${who} قفل طلب تفعيل من غير تنفيذ`],
    [/^\/portal-admin\/activation-requests\/\d+\/resend$/, `${who} بعت رابط تفعيل تاني لطلب تفعيل`],
    [/^\/portal-admin\/activation-requests\/\d+$/, `${who} عدّل ملاحظات طلب تفعيل أو عيّن مراجع`],
    [/^\/portal-activation-requests\/\d+\/confirm$/, `${who} قبل طلب تفعيل`],
    [/^\/portal-activation-requests\/\d+\/reject$/, `${who} رفض طلب تفعيل`],
    [/^\/portal-applications\/\d+\/approve$/, `${who} وافق على ${appText}`],
    [/^\/portal-applications\/\d+\/reject$/, `${who} رفض ${appText}`],
    [/^\/portal-applications\/\d+\/needs-info$/, `${who} طلب معلومات إضافية في ${appText}`],
    [/^\/portal-customers\/\d+\/activation-link$/, `${who} أصدر رابط تفعيل لـ${companyText}`],
    [/^\/portal-customers\/\d+\/admin-code$/, `${who} أصدر كود إدارة لـ${companyText}`],
    [/^\/portal-customers\/\d+\/reset-password$/, `${who} عمل كلمة سر جديدة لـ${companyText}`],
    [/^\/portal-outbox\/\d+\/mark-sent$/, `${who} علّم رسالة إنها أُرسلت يدويًا`],
    [/^\/portal-admin\/settings-history\/\d+\/revert$/, `${who} رجّع إعداد في البوابة لقيمته القديمة`],
    [/^\/portal-admin\/settings\/.+$/, `${who} غيّر إعداد من إعدادات البوابة`],
    [/^\/portal-companies\/bulk$/, `${who} نفّذ إجراء على مجموعة شركات في نفس الوقت`],
    [/^\/portal-companies\/\d+\/members$/, `${who} أضاف موظف يدوي في ${companyText}`],
    [/^\/portal-companies\/\d+\/members\/\d+\/remove$/, `${who} شال موظف من ${companyText}`],
    [/^\/portal-companies\/\d+\/members\/\d+\/suspend$/, `${who} أوقف موظف في ${companyText}`],
    [/^\/portal-companies\/\d+\/members\/\d+\/reactivate$/, `${who} رجّع موظف موقوف في ${companyText}`],
    [/^\/portal-companies\/\d+\/members\/\d+\/reset-link$/, `${who} عمل رابط كلمة سر جديدة لموظف في ${companyText}`],
    [/^\/portal-companies\/\d+\/members\/\d+\/revoke-sessions$/, `${who} قفل كل جلسات موظف في ${companyText}`],
    [/^\/portal-companies\/\d+\/members\/\d+$/, `${who} عدّل بيانات موظف في ${companyText}`],
    [/^\/portal-companies\/\d+\/code\/rotate$/, `${who} غيّر كود الانضمام لـ${companyText}`],
    [/^\/portal-companies\/\d+\/settings-history\/\d+\/revert$/, `${who} رجّع إعداد في ${companyText} لقيمته القديمة`],
    [/^\/portal-companies\/\d+\/settings(\/.+)?$/, `${who} غيّر إعدادات ${companyText}`],
  ];
  for (const [re, s] of rules) if (re.test(path)) return s;
  const first = path.split("/")[1] ?? "";
  const section = SECTIONS[first];
  const verb = METHOD_VERB[method] ?? "نفّذ";
  const num = path.match(/\/(\d+)(?:\/|$)/)?.[1];
  return section ? `${who} ${verb} في «${section}»${num ? ` (رقم ${num})` : ""}` : undefined;
}
