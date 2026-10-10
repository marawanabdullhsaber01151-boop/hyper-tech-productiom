/** @format */
/**
 * Single place that creates portal activation links.
 *
 * - The raw token is returned once and never stored (only its sha256 hash).
 * - Issuing a new link invalidates every older unused link for the customer.
 * - Nothing here logs the raw token or the URL.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Request } from "express";
import type { db } from "../db";
import { portalActivationTokensTable } from "../db/schema";
import { issueAuthToken } from "./authTokens";
import { syncOwnerUserFromCompany } from "./portalCredentials";
import { buildPortalActivationUrl } from "./portalConfig";
import { normalizePhone } from "./identityNormalization";

export const ACTIVATION_DEFAULT_TTL_MINUTES = 24 * 60;
export const ACTIVATION_MIN_TTL_MINUTES = 15;
export const ACTIVATION_MAX_TTL_MINUTES = 30 * 24 * 60;

/** Keep a requested lifetime inside the safe range (defaults when missing). */
export function clampActivationTtlMinutes(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return ACTIVATION_DEFAULT_TTL_MINUTES;
  return Math.min(
    ACTIVATION_MAX_TTL_MINUTES,
    Math.max(ACTIVATION_MIN_TTL_MINUTES, Math.round(n)),
  );
}

export function makeActivationToken(ttlMinutes?: number): {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const rawToken = randomBytes(32).toString("base64url");
  return {
    rawToken,
    tokenHash: createHash("sha256").update(rawToken).digest("hex"),
    expiresAt: new Date(
      Date.now() + clampActivationTtlMinutes(ttlMinutes) * 60_000,
    ),
  };
}

type TokenExecutor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export type IssuedActivation = {
  url: string;
  expiresAt: Date;
  tokenId: number;
  /** the person (owner user) the token belongs to */
  userId: number;
};

/**
 * Issues an activation link for the OWNER of a company. Tokens live in
 * portal_auth_tokens (keyed on the person); older links of the same person are
 * invalidated, and legacy links (portal_activation_tokens) are closed too.
 */
export async function issueActivationLink(
  tx: TokenExecutor,
  req: Request,
  input: { portalCustomerId: number; ttlMinutes?: number; staffId?: number | null },
): Promise<IssuedActivation> {
  const now = new Date();
  await tx
    .update(portalActivationTokensTable)
    .set({ consumedAt: now })
    .where(
      and(
        eq(portalActivationTokensTable.portalCustomerId, input.portalCustomerId),
        isNull(portalActivationTokensTable.consumedAt),
      ),
    );
  const userId = await syncOwnerUserFromCompany(tx, input.portalCustomerId);
  if (!userId) throw new Error("تعذر تجهيز هوية صاحب الحساب");
  const token = await issueAuthToken(tx, {
    userId,
    purpose: "activation",
    ttlMinutes: clampActivationTtlMinutes(input.ttlMinutes),
    createdByStaffId: input.staffId ?? null,
    meta: { companyId: input.portalCustomerId },
  });
  return {
    url: buildPortalActivationUrl(req, token.raw),
    expiresAt: token.expiresAt,
    tokenId: token.id,
    userId,
  };
}

/** wa.me needs digits only, in international form (no +, no 00). */
export function buildWhatsAppLink(
  phone: string | null | undefined,
  text: string,
): string | null {
  const normalized = normalizePhone(phone);
  const digits = normalized.replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function humanDuration(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const d = minutes / (24 * 60);
    return d === 1 ? "24 ساعة" : `${d} أيام`;
  }
  if (minutes % 60 === 0) return `${minutes / 60} ساعة`;
  return `${minutes} دقيقة`;
}

export function buildActivationMessage(
  customerName: string,
  url: string,
  expiresAt: Date,
  supportPhone?: string,
): string {
  const minutes = Math.max(
    1,
    Math.round((expiresAt.getTime() - Date.now()) / 60_000),
  );
  const lines = [
    `أهلاً ${customerName}، حسابك في Hyper-Tech جاهز.`,
    `افتح الرابط واختار كلمة السر (صالح ${humanDuration(minutes)}): ${url}`,
  ];
  if (supportPhone) lines.push(`لو احتجت مساعدة كلمنا على ${supportPhone}`);
  return lines.join("\n");
}

export function supportPhone(): string | undefined {
  return process.env.PORTAL_SUPPORT_PHONE?.trim() || undefined;
}

/** What the admin UI receives right after approve/confirm/regenerate. */
export function buildActivationPayload(
  customer: { fullName: string; phone: string },
  issued: IssuedActivation,
  delivered: boolean,
) {
  const message = buildActivationMessage(
    customer.fullName,
    issued.url,
    issued.expiresAt,
    supportPhone(),
  );
  return {
    url: issued.url,
    expiresAt: issued.expiresAt,
    whatsappUrl: buildWhatsAppLink(customer.phone, message),
    message,
    delivered,
  };
}
