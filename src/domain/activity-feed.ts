/** @format */
// سجل النشاط (الخطوة 38أ): تقسيم الأحداث لأقسام، وإخفاء صف المسار الخام لو فيه حدث تفصيلي له. نقي من غير قاعدة بيانات.

export interface ActivitySection { id: string; label: string; prefixes: readonly string[]; paths: readonly string[] }

/** prefixes = بادئات مفاتيح الأحداث التفصيلية، paths = أول جزء من مسار الطلب الخام (post /api/v1/<path>/...). */
export const ACTIVITY_SECTIONS: readonly ActivitySection[] = [
  { id: "sales", label: "المبيعات", prefixes: ["sales."], paths: ["sales"] },
  { id: "purchases", label: "المشتريات والاستلام", prefixes: ["purchases."], paths: ["purchases"] },
  { id: "production", label: "الإنتاج", prefixes: ["production.", "productionWorkflow.", "production_workflow.", "production_request."], paths: ["production"] },
  { id: "operations", label: "التشغيل", prefixes: ["operations."], paths: ["operations"] },
  { id: "engineering", label: "الهندسة والوصفات", prefixes: ["engineering.", "bom."], paths: ["engineering", "bom"] },
  { id: "planning", label: "التخطيط", prefixes: ["planning."], paths: ["planning"] },
  { id: "inventory", label: "المخزون", prefixes: ["inventory."], paths: ["inventory", "movements"] },
  { id: "contacts", label: "جهات الاتصال", prefixes: ["contacts."], paths: ["contacts"] },
  { id: "portal", label: "بوابة العملاء", prefixes: ["portal.", "portal_orders.", "company.", "member.", "join."], paths: ["portal"] },
  { id: "chat", label: "المحادثات", prefixes: ["chat."], paths: ["chat"] },
  { id: "auth", label: "الدخول والحساب", prefixes: ["auth."], paths: ["auth"] },
  { id: "governance", label: "الحوكمة والإعدادات", prefixes: ["governance.", "setting.", "role."], paths: ["governance", "settings", "users"] },
  { id: "foundation", label: "البيانات الأساسية", prefixes: ["foundation."], paths: ["foundation"] },
];

export const SECTION_IDS = ACTIVITY_SECTIONS.map((s) => s.id);
export const isSectionId = (id: string): boolean => SECTION_IDS.includes(id);

const RAW = /^(post|put|patch|delete) (\/\S*)$/;
export const isRawKey = (key: string): boolean => RAW.test(key);

/** القسم بتاع مفتاح حدث (تفصيلي أو مسار خام)؛ "other" لو مجهول. */
export function sectionOf(key: string): string {
  const m = key.match(RAW);
  if (m) {
    const first = (m[2]!.replace(/^\/api\/v\d+/, "").split("/")[1] ?? "").toLowerCase();
    return ACTIVITY_SECTIONS.find((s) => s.paths.some((p) => first.startsWith(p)))?.id ?? "other";
  }
  return ACTIVITY_SECTIONS.find((s) => s.prefixes.some((p) => key.startsWith(p)))?.id ?? "other";
}

/** regex (PostgreSQL) لمسارات القسم الخام. القيم ثابتة من الجدول فوق، مفيش مدخل مستخدم فيه. */
export function pathRegex(sectionId: string): string | null {
  const s = ACTIVITY_SECTIONS.find((x) => x.id === sectionId);
  if (!s) return null;
  return `^(post|put|patch|delete) (/api/v[0-9]+)?/(${s.paths.join("|")})[a-z_-]*(/|$)`;
}

/** أحداث «فتح/عرض» كتير وبتزحم السجل؛ بتتخبي إلا لو المستخدم طلبها. */
export const isViewKey = (key: string): boolean => key === "chat.view" || key.endsWith(".viewed");

export interface FeedRowLike { id: number; actionKey: string; actorUserId: number | null; createdAt: Date | string }

/**
 * كل عملية بتتسجّل مرتين: صف مسار خام (شبكة الأمان) + حدث تفصيلي. لو لقينا حدث تفصيلي لنفس الشخص
 * في نفس القسم خلال WINDOW_MS من الصف الخام، نخفي الخام عشان الجملة ما تتكررش. الخام اللي ملوش تفصيلي بيفضل.
 */
export const SHADOW_WINDOW_MS = 5000;
export function dropShadowedRows<T extends FeedRowLike>(rows: readonly T[]): T[] {
  const detailed = rows.filter((r) => !isRawKey(r.actionKey)).map((r) => ({ actor: r.actorUserId, section: sectionOf(r.actionKey), at: new Date(r.createdAt).getTime() }));
  return rows.filter((r) => {
    if (!isRawKey(r.actionKey)) return true;
    const sec = sectionOf(r.actionKey);
    const at = new Date(r.createdAt).getTime();
    return !detailed.some((d) => d.actor === r.actorUserId && d.section === sec && Math.abs(d.at - at) <= SHADOW_WINDOW_MS);
  });
}
