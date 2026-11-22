// دليل النظام (م4): «ابدأ من هنا». كل خطوة بتشاور على شاشة (SCREENS) وزرار حقيقي فيها، والنصوص في copy/guide4.ts. اختبار الانحدار بيتأكد إن كل دور يلاقي خطوات يقدر يفتحها وإن الأزرار موجودة.

import type { ScreenDef } from "./guideScreens";

export interface StartStep { screen: string; btn: string }
export interface StartGroup { id: string; roles: readonly string[]; steps: readonly StartStep[] }
export const START_GROUPS: readonly StartGroup[] = [
  { id: "sales", roles: ["sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"], steps: [{ screen: "chat", btn: "claim" }, { screen: "portalAdmin", btn: "poConfirm" }, { screen: "contacts", btn: "new" }, { screen: "quotes", btn: "send" }, { screen: "sales", btn: "new" }] },
  { id: "management", roles: ["chairman", "executive_manager"], steps: [{ screen: "approvals", btn: "approve" }, { screen: "health", btn: "all" }, { screen: "operations", btn: "promise" }, { screen: "ledger", btn: "collect" }, { screen: "activity", btn: "views" }] },
  { id: "opsmgr", roles: ["operations_manager"], steps: [{ screen: "operations", btn: "claim" }, { screen: "operations", btn: "plan" }, { screen: "porders", btn: "receive" }, { screen: "approvals", btn: "approve" }, { screen: "operations", btn: "promise" }] },
  { id: "prodmgr", roles: ["production_manager"], steps: [{ screen: "preq", btn: "approve" }, { screen: "porders", btn: "receive" }, { screen: "pexec", btn: "batch" }, { screen: "planning", btn: "save" }, { screen: "approvals", btn: "approve" }] },
  { id: "supervisor", roles: ["supervisor", "production_controller"], steps: [{ screen: "porders", btn: "advance" }, { screen: "pexec", btn: "batch" }, { screen: "pexec", btn: "ncr" }, { screen: "engineering", btn: "" }] },
  { id: "warehouse", roles: ["warehouse_manager", "storekeeper"], steps: [{ screen: "preq", btn: "reject" }, { screen: "porders", btn: "decide" }, { screen: "purchases", btn: "receive" }, { screen: "stock", btn: "move" }, { screen: "stock", btn: "count" }] },
  { id: "purchasing", roles: ["purchasing_manager", "buyer"], steps: [{ screen: "purchases", btn: "new" }, { screen: "purchases", btn: "submit" }, { screen: "purchases", btn: "send" }, { screen: "stock", btn: "" }] },
  { id: "quality", roles: ["production_quality_controller", "quality_engineer"], steps: [{ screen: "inspect", btn: "" }, { screen: "inspect", btn: "start" }, { screen: "inspect", btn: "" }] },
  { id: "rawq", roles: ["raw_material_quality_controller"], steps: [{ screen: "receiving", btn: "inspect" }, { screen: "receiving", btn: "save" }, { screen: "inspect", btn: "" }] },
];
export const groupOfRole = (role: string | undefined): StartGroup | undefined => START_GROUPS.find((g) => role && g.roles.includes(role));
export const PORTAL_STEPS: readonly (StartStep & { who: "customer" | "staff" })[] = [
  { screen: "pLogin", btn: "apply", who: "customer" },
  { screen: "portalAdmin", btn: "acConfirm", who: "staff" },
  { screen: "pLogin", btn: "login", who: "customer" },
  { screen: "pShop", btn: "add", who: "customer" },
  { screen: "pShop", btn: "decline", who: "customer" },
  { screen: "pTeam", btn: "add", who: "customer" },
];
export const SAFE_ITEMS: readonly { id: string; screen: string; btn: string }[] = [
  { id: "selfApprove", screen: "approvals", btn: "verify" },
  { id: "tiers", screen: "approvals", btn: "polAdd" },
  { id: "sla", screen: "approvals", btn: "approve" },
  { id: "audit", screen: "approvals", btn: "verify" },
  { id: "credit", screen: "ledger", btn: "limit" },
  { id: "ledger", screen: "ledger", btn: "reverse" },
  { id: "archive", screen: "portalAdmin", btn: "archive" },
  { id: "mask", screen: "stock", btn: "" },
  { id: "tfa", screen: "settings", btn: "tfa" },
];
export const FAQ_IDS: readonly string[] = ["noBtn", "stuck", "wrong", "price", "paid", "who", "phone", "lost"];
export type { ScreenDef };
