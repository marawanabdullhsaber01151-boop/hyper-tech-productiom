/** @format */
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { portalAuthTokensTable } from "../db/schema";
import { deliver } from "./channels/deliver";
import { humanDuration, renderTemplate } from "./channels/templates";
import { buildWhatsAppLink, type IssuedActivation } from "./portalActivation";

/**
 * Tries the configured channels for the activation link and ALWAYS returns the
 * manual fallback (wa.me link + message) for the staff member who asked.
 * Shape stays compatible with the old buildActivationPayload().
 */
export async function deliverActivation(
  customer: { fullName: string; phone: string },
  issued: IssuedActivation,
  ctx: { companyId: number; staffId?: number | null },
) {
  const minutes = Math.max(1, Math.round((issued.expiresAt.getTime() - Date.now()) / 60_000));
  const vars = { name: customer.fullName, url: issued.url, duration: humanDuration(minutes) };
  const rendered = await renderTemplate("activation", vars);
  const result = await deliver({
    purpose: "activation",
    userId: issued.userId,
    companyId: ctx.companyId,
    template: "activation",
    vars,
    actor: { staffId: ctx.staffId ?? null },
    allowUnverified: true,
    includeManual: true,
  });
  if (result.emailSent) {
    // the link really reached the address on file → activating proves ownership
    await db
      .update(portalAuthTokensTable)
      .set({ meta: sql`${portalAuthTokensTable.meta} || '{"viaEmail":true}'::jsonb` })
      .where(eq(portalAuthTokensTable.id, issued.tokenId));
  }
  return {
    url: issued.url,
    expiresAt: issued.expiresAt,
    whatsappUrl: buildWhatsAppLink(customer.phone, rendered.text),
    message: rendered.text,
    delivered: result.delivered,
    channels: result.results,
  };
}
