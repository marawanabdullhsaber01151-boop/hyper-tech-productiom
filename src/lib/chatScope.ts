/** @format */
/**
 * Plan 08 — أي محادثة بتخص الطلب ده؟
 *   shared               → محادثة الشركة (member_id = null)
 *   per_member           → محادثة الموظف لوحده
 *   per_member_monitored → زي اللي فوق + اللي معاه chat.view_company يشوفها (قراءة بس)
 */
import type { Request } from "express";
import { resolveSetting } from "./portalSettings";
import { scopeFrom, type ChatScope } from "./chatScopeCore";

export type { ChatScope };

export async function chatScopeFor(req: Request): Promise<ChatScope> {
  const companyId = req.portalCustomer!.portalCustomerId;
  const memberId = req.portalAuth?.memberId ?? req.portalCustomer?.memberId ?? null;
  const mode = await resolveSetting<ChatScope["mode"]>("chat.mode", { companyId, memberId });
  return scopeFrom(mode, memberId, req.portalAuth?.can("chat.view_company") ?? false);
}
