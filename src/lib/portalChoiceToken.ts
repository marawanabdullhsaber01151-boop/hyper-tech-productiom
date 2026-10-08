/** @format */
/**
 * Short-lived signed token used between "password OK" and "which company?".
 * Stateless (HMAC), 5 minutes, bound to one user. It proves the password was
 * just verified; it is NOT a session and grants nothing else.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 5 * 60_000;

function secret(): string {
  const s = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!s) throw new Error("JWT_SECRET or SESSION_SECRET is required");
  return `portal-choice:${s}`;
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function makeChoiceToken(userId: number, rememberMe: boolean, now = Date.now()): string {
  const body = Buffer.from(
    JSON.stringify({ u: userId, r: rememberMe ? 1 : 0, e: now + TTL_MS }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readChoiceToken(
  token: string,
  now = Date.now(),
): { userId: number; rememberMe: boolean } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      u: number;
      r: number;
      e: number;
    };
    if (!Number.isSafeInteger(data.u) || typeof data.e !== "number" || data.e < now) return null;
    return { userId: data.u, rememberMe: data.r === 1 };
  } catch {
    return null;
  }
}
