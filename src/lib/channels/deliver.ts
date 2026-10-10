/** @format */
/**
 * Intent → policy → adapters → outbox.
 * Honest: a row says `sent` only when an adapter really delivered. Manual
 * WhatsApp is recorded as `manual_pending` and handed back as a wa.me link.
 * Message text is never stored; destinations are stored masked.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { portalChannelsTable, portalOutboxTable, portalUsersTable } from "../../db/schema";
import { buildWhatsAppLink } from "../portalActivation";
import { logger } from "../logger";
import { resolveSetting } from "../portalSettings";
import { getChannelAdapter } from "./registry";
import { renderTemplate, type TemplateKey } from "./templates";
import { maskAddress, type ChannelId } from "./types";

export type DeliverPurpose = "activation" | "recovery" | "alert" | "channel_verify";

export type DeliverInput = {
  purpose: DeliverPurpose;
  userId: number;
  companyId?: number | null;
  template: TemplateKey;
  vars: Record<string, string | number | undefined>;
  actor?: { staffId?: number | null; memberId?: number | null };
  /** Use the email / phone the account was created with even if not verified (activation, invites). */
  allowUnverified?: boolean;
  /** Only these channels (e.g. verify an email address → ["email"] to that address). */
  only?: ChannelId[];
  /** Explicit destination (channel verification of a not-yet-saved address). */
  explicitTo?: { email?: string };
  /** Give the caller a wa.me link (authorized staff / owner flows only). */
  includeManual?: boolean;
};

export type DeliverResult = {
  delivered: boolean;
  results: Array<{ channel: ChannelId; status: string; destination: string | null }>;
  whatsappUrl: string | null;
  /** set when email was really sent to the address on file (activation proves ownership) */
  emailSent: boolean;
};

type Target = { channel: ChannelId; to: string };

function settingKey(p: DeliverPurpose): string {
  return p === "activation" ? "delivery.activation.channels"
    : p === "recovery" ? "delivery.recovery.channels"
    : "delivery.alert.channels";
}

async function collectTargets(input: DeliverInput, order: ChannelId[]): Promise<Target[]> {
  const [user] = await db
    .select({ phone: portalUsersTable.phone, email: portalUsersTable.email })
    .from(portalUsersTable)
    .where(eq(portalUsersTable.id, input.userId))
    .limit(1);
  if (!user) return [];
  const chans = await db
    .select()
    .from(portalChannelsTable)
    .where(and(eq(portalChannelsTable.userId, input.userId), eq(portalChannelsTable.enabled, true)));
  const verified = chans.filter((c) => c.verifiedAt);
  const targets: Target[] = [];
  for (const ch of order) {
    if (input.only && !input.only.includes(ch)) continue;
    if (ch === "email") {
      if (input.explicitTo?.email) {
        targets.push({ channel: "email", to: input.explicitTo.email });
        continue;
      }
      const v = verified.filter((c) => c.type === "email").map((c) => c.address);
      if (v.length) v.forEach((to) => targets.push({ channel: "email", to }));
      else if (input.allowUnverified && user.email) targets.push({ channel: "email", to: user.email });
    } else if (ch === "telegram") {
      verified.filter((c) => c.type === "telegram").forEach((c) => targets.push({ channel: "telegram", to: c.address }));
    } else if (ch === "sms") {
      if (user.phone) targets.push({ channel: "sms", to: user.phone });
    }
  }
  return targets;
}

async function record(input: DeliverInput, channel: ChannelId, status: string, extra: { provider?: string; errorCode?: string; masked?: string | null; sentAt?: Date } = {}) {
  await db.insert(portalOutboxTable).values({
    userId: input.userId,
    companyId: input.companyId ?? null,
    purpose: input.purpose,
    channel,
    status,
    provider: extra.provider ?? null,
    errorCode: extra.errorCode ?? null,
    attempts: status === "manual_pending" ? 0 : 1,
    templateKey: input.template,
    maskedDestination: extra.masked ?? null,
    createdByStaffId: input.actor?.staffId ?? null,
    createdByMemberId: input.actor?.memberId ?? null,
    sentAt: extra.sentAt ?? null,
  });
}

export async function deliver(input: DeliverInput): Promise<DeliverResult> {
  const strategy = await resolveSetting<"first_success" | "all_verified" | "manual_only">("delivery.strategy", {});
  const order = (await resolveSetting<ChannelId[]>(settingKey(input.purpose), {})).filter((c) => c !== "whatsapp_manual");
  const msg = await renderTemplate(input.template, input.vars);
  const result: DeliverResult = { delivered: false, results: [], whatsappUrl: null, emailSent: false };

  if (strategy !== "manual_only") {
    const targets = await collectTargets(input, order);
    for (const t of targets) {
      const adapter = getChannelAdapter(t.channel as Exclude<ChannelId, "whatsapp_manual">);
      const masked = maskAddress(t.channel, t.to);
      if (!adapter.isConfigured()) {
        result.results.push({ channel: t.channel, status: "not_configured", destination: masked });
        continue;
      }
      let r: { ok: boolean; errorCode?: string };
      try {
        r = await adapter.send({ to: t.to, subject: msg.subject, text: msg.text });
      } catch {
        r = { ok: false, errorCode: "exception" };
      }
      if (r.ok) {
        await record(input, t.channel, "sent", { provider: adapter.provider, masked, sentAt: new Date() });
        result.results.push({ channel: t.channel, status: "sent", destination: masked });
        result.delivered = true;
        if (t.channel === "email") result.emailSent = true;
        if (strategy === "first_success") break;
      } else {
        await record(input, t.channel, "failed", { provider: adapter.provider, errorCode: r.errorCode ?? "failed", masked });
        result.results.push({ channel: t.channel, status: "failed", destination: masked });
      }
    }
  }

  if (input.includeManual || strategy === "manual_only") {
    const [user] = await db.select({ phone: portalUsersTable.phone }).from(portalUsersTable).where(eq(portalUsersTable.id, input.userId)).limit(1);
    const url = user ? buildWhatsAppLink(user.phone, msg.text) : null;
    if (url && !result.delivered) {
      result.whatsappUrl = url;
      await record(input, "whatsapp_manual", "manual_pending", { provider: "wa.me", masked: maskAddress("whatsapp_manual", user!.phone) });
      result.results.push({ channel: "whatsapp_manual", status: "manual_pending", destination: maskAddress("whatsapp_manual", user!.phone) });
    } else if (url) {
      // delivered already, still hand back the link for the staff fallback without logging an extra row
      result.whatsappUrl = url;
    }
  }
  return result;
}

/** Security alert on every verified channel (email + telegram). Never throws. */
export async function sendSecurityAlert(userId: number, template: "password_changed" | "recovery_code_used", companyId?: number | null): Promise<void> {
  try {
    await deliver({ purpose: "alert", userId, companyId, template, vars: {}, allowUnverified: false, only: ["email", "telegram"] });
  } catch (e) {
    logger.warn("Security alert failed", { errorClass: e instanceof Error ? e.name : "unknown" });
  }
}
