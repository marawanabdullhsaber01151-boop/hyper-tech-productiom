/**
 * «دليل البوابة»: نموذج بيانات من غير أي نص عربي (النصوص في copy/portalGuide.ts).
 * كل قسم بيظهر لعضو الشركة حسب صلاحياته الفعلية (نفس قاعدة can() في session.ts: رئيس الشركة معاه كل حاجة).
 * `src` في الجزء = مفتاح النص الحقيقي على الشاشة، واسمه في الدليل لازم يطابقه حرفيًا (اختبار بيضمن كده).
 */
import "../copy/transfers";
import "../copy/balances";
import "../copy/chat";

/** قايمة «أي واحدة منهم»؛ فاضية = للكل. */
export type Perms = readonly string[];
export interface PStep { id: string; perm?: Perms }
export interface PPart { id: string; src: string; perm?: Perms }
export interface PSection {
  id: string;
  /** اسم الصفحة في القايمة الجانبية */
  nav: string;
  to: string;
  perm?: Perms;
  steps: readonly PStep[];
  parts: readonly PPart[];
  tips: number;
}

export interface PViewer { isOwner: boolean; permissions: readonly string[] }
export const allowed = (v: PViewer, perm?: Perms): boolean => !perm || perm.length === 0 || v.isOwner || perm.some((k) => v.permissions.includes(k));

const s = (id: string, perm?: Perms): PStep => ({ id, perm });
const p = (id: string, src: string, perm?: Perms): PPart => ({ id, src, perm });

const ORDERS_VIEW = ["orders.view_own", "orders.view_company"] as const;
const CANCEL = ["orders.cancel_own", "orders.cancel_company"] as const;

export const SECTIONS: readonly PSection[] = [
  {
    id: "start", nav: "p.nav.home", to: "/portal/home", tips: 3,
    steps: [s("1"), s("2"), s("3"), s("4"), s("5")],
    parts: [p("bell", "p.nav.notifications"), p("logout", "p.account.logout")],
  },
  {
    id: "home", nav: "p.nav.home", to: "/portal/home", tips: 2,
    steps: [s("1"), s("2", ["cart.use"]), s("3", ORDERS_VIEW), s("4", ["cart.use"]), s("5")],
    parts: [p("latest", "p.home.latest", ORDERS_VIEW), p("all", "p.home.all", ORDERS_VIEW), p("reorder", "p.home.reorder", ["cart.use"]), p("cart", "p.home.openCart", ["cart.use"]), p("browse", "p.home.browse")],
  },
  {
    id: "products", nav: "p.nav.products", to: "/portal/products", tips: 3,
    steps: [s("1"), s("2"), s("3"), s("4", ["cart.use"]), s("5"), s("6", ["cart.use"])],
    parts: [p("add", "p.products.add", ["cart.use"]), p("ask", "p.products.priceAsk"), p("fav", "p.products.favorite", ["cart.use"]), p("onlyFav", "p.products.onlyFav", ["cart.use"]), p("cartons", "p.products.cartons")],
  },
  {
    id: "cart", nav: "p.nav.cart", to: "/portal/cart", perm: ["cart.use"], tips: 3,
    steps: [s("1"), s("2"), s("3"), s("4"), s("5", ["orders.create"]), s("6", ["orders.create"]), s("7", ["orders.create"]), s("8")],
    parts: [p("piece", "p.cart.byPiece"), p("carton", "p.cart.byCarton"), p("priority", "p.cart.priority"), p("notes", "p.cart.notes"), p("review", "p.cart.review", ["orders.create"]), p("send", "p.cart.send", ["orders.create"])],
  },
  {
    id: "orders", nav: "p.nav.orders", to: "/portal/orders", perm: ORDERS_VIEW, tips: 3,
    steps: [s("1"), s("2"), s("3", ["orders.view_company"]), s("4"), s("5"), s("6", CANCEL), s("7", ["cart.use"]), s("8")],
    parts: [
      p("tabOrders", "p.inq.tab.orders"), p("mine", "p.orders.scope.mine", ["orders.view_company"]), p("all", "p.orders.scope.all", ["orders.view_company"]),
      p("timeline", "p.orders.timeline"), p("cancel", "p.orders.cancel", CANCEL), p("reorder", "p.orders.reorder", ["cart.use"]), p("more", "p.orders.more"),
    ],
  },
  {
    id: "quotes", nav: "p.nav.orders", to: "/portal/orders?tab=quotes", perm: ORDERS_VIEW, tips: 2,
    steps: [s("1"), s("2"), s("3"), s("4", ["orders.create"]), s("5", ["orders.create"]), s("6")],
    parts: [p("tabInq", "p.inq.tab.inquiries"), p("tabQuotes", "p.qt.tab"), p("order", "p.qt.order", ["orders.create"]), p("decline", "p.qt.decline", ["orders.create"]), p("agreed", "p.ag.title")],
  },
  {
    id: "payments", nav: "p.nav.payments", to: "/portal/payments", perm: ["payments.report"], tips: 3,
    steps: [s("1"), s("2"), s("3"), s("4"), s("5")],
    parts: [p("new", "tr.p.new"), p("amount", "tr.f.amount"), p("date", "tr.f.date"), p("method", "tr.f.method"), p("ref", "tr.f.reference"), p("note", "tr.f.note"), p("send", "tr.f.send")],
  },
  {
    id: "balances", nav: "p.nav.balances", to: "/portal/balances", perm: ["payments.confirm_balance"], tips: 3,
    steps: [s("1"), s("2"), s("3"), s("4"), s("5")],
    parts: [p("show", "bc.p.show"), p("mine", "bc.p.myAmount"), p("agree", "bc.p.agree"), p("dispute", "bc.p.dispute")],
  },
  {
    id: "chat", nav: "p.nav.chat", to: "/portal/chat", perm: ["chat.use"], tips: 2,
    steps: [s("1"), s("2"), s("3"), s("4", ["chat.view_company"]), s("5")],
    parts: [p("mine", "c.p.tab.mine", ["chat.view_company"]), p("team", "c.p.tab.team", ["chat.view_company"]), p("topic", "c.p.topic"), p("wa", "c.p.wa"), p("rate", "c.p.rate.title")],
  },
  {
    id: "team", nav: "p.nav.team", to: "/portal/team", perm: ["team.view"], tips: 3,
    steps: [s("1"), s("2"), s("3", ["team.invite"]), s("4", ["team.manage"]), s("5", ["team.approve_join"]), s("6", ["company.manage_code"]), s("7", ["company.settings"]), s("8", ["audit.view"])],
    parts: [
      p("members", "p.team.tab.members"), p("add", "p.team.add", ["team.invite"]), p("role", "p.team.changeRole", ["team.manage"]), p("suspend", "p.team.suspend", ["team.manage"]),
      p("reactivate", "p.team.reactivate", ["team.manage"]), p("remove", "p.team.remove", ["team.manage"]), p("reset", "p.team.resetLink", ["team.manage"]),
      p("requests", "p.team.tab.requests", ["team.approve_join"]), p("approve", "p.team.req.approve", ["team.approve_join"]), p("reject", "p.team.req.reject", ["team.approve_join"]),
      p("copy", "p.team.code.copy", ["company.manage_code"]), p("rotate", "p.team.code.rotate", ["company.manage_code"]), p("mode", "p.team.join.mode", ["company.settings"]),
      p("activity", "p.team.tab.activity", ["audit.view"]),
    ],
  },
  {
    id: "account", nav: "p.nav.account", to: "/portal/account", tips: 3,
    steps: [s("1"), s("2", ["company.edit_profile"]), s("3"), s("4"), s("5"), s("6")],
    parts: [
      p("profile", "p.account.tab.profile"), p("edit", "p.prof.edit", ["company.edit_profile"]), p("security", "p.account.tab.security"), p("change", "p.sec.change"),
      p("others", "p.sec.revokeOthers"), p("email", "p.sec.addEmail"), p("telegram", "p.sec.linkTelegram"), p("codes", "p.sec.newCodes"), p("prefs", "p.account.tab.prefs"),
    ],
  },
  {
    id: "notif", nav: "p.nav.notifications", to: "/portal/notifications", tips: 2,
    steps: [s("1"), s("2"), s("3", ["notifications.company"])],
    parts: [p("markAll", "p.notif.markAll")],
  },
];

/** الصلاحيات اللي السيرفر بيفرضها فعلًا (بالترتيب والمجموعة)، عشان قايمة «تقدر / مش متاح ليك». */
export const ENFORCED_PERMS = [
  "cart.use", "orders.create", "orders.view_own", "orders.view_company", "orders.cancel_own", "orders.cancel_company",
  "payments.report", "payments.confirm_balance", "chat.use", "chat.view_company",
  "team.view", "team.invite", "team.manage", "team.approve_join", "company.edit_profile", "company.manage_code", "company.settings", "audit.view", "notifications.company",
] as const;

/** صلاحيات متسجلة في الأدوار بس السيرفر لسه ما بيقفلش بيها حاجة. */
export const UNENFORCED_PERMS = ["catalog.view", "prices.view_reference", "inquiries.create", "inquiries.view_company"] as const;

export interface PCatalogSection { section: PSection; steps: PStep[]; parts: PPart[] }

/** الأقسام المفتوحة لعضو معيّن: القسم نفسه + الخطوات والأجزاء المسموحة، والقسم من غير خطوات بيتخبى. */
export function portalCatalog(v: PViewer): PCatalogSection[] {
  const out: PCatalogSection[] = [];
  for (const section of SECTIONS) {
    if (!allowed(v, section.perm)) continue;
    const steps = section.steps.filter((x) => allowed(v, x.perm));
    if (steps.length === 0) continue;
    out.push({ section, steps: [...steps], parts: section.parts.filter((x) => allowed(v, x.perm)) });
  }
  return out;
}

export const grantedAbilities = (v: PViewer): string[] => ENFORCED_PERMS.filter((k) => allowed(v, [k]));
export const missingAbilities = (v: PViewer): string[] => ENFORCED_PERMS.filter((k) => !allowed(v, [k]));
