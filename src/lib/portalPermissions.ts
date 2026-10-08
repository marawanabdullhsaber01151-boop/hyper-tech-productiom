/** @format */
/**
 * Portal permission REGISTRY (keys only live in code; roles live in the DB).
 *
 * Effective permissions of a member =
 *   owner ? ALL : expand(role.permissions ∪ overrides.allow) − overrides.deny
 * where expand() adds every key implied by a granted key.
 * A "deny" override always wins, even over an implied grant.
 */

export type PortalPermissionDef = {
  key: string;
  group: string;
  label: string; // simple Arabic name shown in the UI
  description: string; // one sentence
  dangerous?: boolean;
  implies?: readonly string[];
};

export const PORTAL_PERMISSION_GROUPS = [
  { key: "shopping", label: "التسوق" },
  { key: "orders", label: "الطلبات" },
  { key: "inquiries", label: "طلبات الأسعار" },
  { key: "chat", label: "المحادثة" },
  { key: "team", label: "الفريق" },
  { key: "company", label: "الشركة" },
  { key: "security", label: "الأمان والمتابعة" },
] as const;

export const PORTAL_PERMISSIONS: readonly PortalPermissionDef[] = [
  { key: "catalog.view", group: "shopping", label: "يتصفح المنتجات", description: "يشوف كتالوج المنتجات." },
  { key: "prices.view_reference", group: "shopping", label: "يشوف الأسعار المرجعية", description: "يشوف الأسعار المرجعية والقيمة التقديرية." },
  { key: "cart.use", group: "shopping", label: "يستخدم السلة", description: "يضيف منتجات للسلة والمفضلة.", implies: ["catalog.view"] },
  { key: "orders.create", group: "orders", label: "يبعت طلبات", description: "يبعت طلبات للمبيعات.", implies: ["cart.use", "orders.view_own"] },
  { key: "orders.view_own", group: "orders", label: "يشوف طلباته", description: "يشوف الطلبات اللي هو بعتها." },
  { key: "orders.view_company", group: "orders", label: "يشوف طلبات الشركة كلها", description: "يشوف طلبات كل الموظفين ومين بعتها.", implies: ["orders.view_own"] },
  { key: "orders.cancel_own", group: "orders", label: "يلغي طلباته", description: "يلغي طلباته هو.", implies: ["orders.view_own"] },
  { key: "orders.cancel_company", group: "orders", label: "يلغي أي طلب في الشركة", description: "يلغي طلب أي موظف في الشركة.", dangerous: true, implies: ["orders.cancel_own", "orders.view_company"] },
  { key: "inquiries.create", group: "inquiries", label: "يسأل عن سعر", description: "يبعت طلب سعر للمبيعات." },
  { key: "inquiries.view_company", group: "inquiries", label: "يشوف طلبات أسعار الشركة", description: "يشوف طلبات الأسعار بتاعة كل الموظفين.", implies: ["inquiries.create"] },
  { key: "chat.use", group: "chat", label: "يتواصل مع المبيعات", description: "يستخدم المحادثة مع فريق المبيعات." },
  { key: "chat.view_company", group: "chat", label: "يراقب محادثات الشركة", description: "يشوف محادثات باقي الموظفين.", dangerous: true, implies: ["chat.use"] },
  { key: "team.view", group: "team", label: "يشوف الفريق", description: "يشوف الموظفين وأدوارهم." },
  { key: "team.invite", group: "team", label: "يضيف موظفين", description: "يضيف موظف جديد للشركة.", implies: ["team.view"] },
  { key: "team.manage", group: "team", label: "يدير الفريق", description: "يعدّل الأدوار والصلاحيات ويوقف الموظفين.", dangerous: true, implies: ["team.view", "team.invite"] },
  { key: "team.approve_join", group: "team", label: "يوافق على طلبات الانضمام", description: "يقبل أو يرفض طلبات الانضمام بالكود.", implies: ["team.view"] },
  { key: "company.edit_profile", group: "company", label: "يعدّل بيانات الشركة", description: "يعدّل اسم الشركة والعنوان والتليفون." },
  { key: "company.manage_code", group: "company", label: "يدير كود الشركة", description: "يشوف كود الانضمام ويغيّره.", dangerous: true },
  { key: "company.settings", group: "company", label: "يعدّل إعدادات الشركة", description: "يغيّر طريقة الانضمام وإعدادات الفريق.", dangerous: true },
  { key: "audit.view", group: "security", label: "يشوف سجل النشاط", description: "يشوف مين عمل إيه في حساب الشركة." },
  { key: "notifications.company", group: "security", label: "يستقبل إشعارات الشركة", description: "تجيله إشعارات الطلبات والانضمام والإلغاء." },
] as const;

export const PORTAL_PERMISSION_KEYS: readonly string[] = PORTAL_PERMISSIONS.map((p) => p.key);
const KEY_SET = new Set(PORTAL_PERMISSION_KEYS);
const BY_KEY = new Map(PORTAL_PERMISSIONS.map((p) => [p.key, p]));

export function isPortalPermissionKey(value: string): boolean {
  return KEY_SET.has(value);
}

/** Adds every key implied (transitively) by the granted keys. Unknown keys are dropped. */
export function expandPermissions(granted: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...granted].filter((k) => KEY_SET.has(k));
  while (stack.length) {
    const key = stack.pop()!;
    if (out.has(key)) continue;
    out.add(key);
    for (const implied of BY_KEY.get(key)?.implies ?? []) stack.push(implied);
  }
  return out;
}

export type PermissionOverride = { permissionKey: string; effect: "allow" | "deny" };

export function resolveEffectivePermissions(input: {
  isOwner: boolean;
  rolePermissions: readonly string[];
  overrides?: readonly PermissionOverride[];
}): Set<string> {
  if (input.isOwner) return new Set(PORTAL_PERMISSION_KEYS);
  const overrides = input.overrides ?? [];
  const granted = [
    ...input.rolePermissions,
    ...overrides.filter((o) => o.effect === "allow").map((o) => o.permissionKey),
  ];
  const effective = expandPermissions(granted);
  for (const o of overrides) {
    if (o.effect === "deny") effective.delete(o.permissionKey);
  }
  return effective;
}

/** Keeps only registry keys, de-duplicated, in registry order. */
export function sanitizePermissionList(keys: readonly string[]): string[] {
  const wanted = new Set(keys);
  return PORTAL_PERMISSION_KEYS.filter((k) => wanted.has(k));
}
