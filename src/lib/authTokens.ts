/** @format */
/**
 * One-time credentials for the portal (activation / reset / invite / channel link).
 *
 * - Long tokens: 32 random bytes, only their sha256 is stored.
 * - Short codes (8 digits): HMAC-SHA256 with a server pepper bound to the user,
 *   limited attempts, compared in constant time.
 * - Nothing here logs a token, code or link.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { portalAuthTokensTable, type AuthTokenPurpose } from "../db/schema";

type Tx = Pick<typeof db, "select" | "insert" | "update">;

export const CODE_MAX_ATTEMPTS = 5;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function pepper(): string {
  const p = process.env.AUTH_CODE_PEPPER?.trim() || process.env.JWT_SECRET?.trim();
  if (!p) throw new Error("AUTH_CODE_PEPPER (or JWT_SECRET) must be set");
  return p;
}

/** Keyed hash for short codes; bound to the user so a code is useless elsewhere. */
export function hashCode(userId: number, code: string): string {
  return createHmac("sha256", pepper()).update(`${userId}:${code.replace(/[\s-]/g, "").toUpperCase()}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function generateNumericCode(digits = 8): string {
  let out = "";
  for (let i = 0; i < digits; i++) out += String(randomInt(0, 10));
  return out;
}

export type IssueInput = {
  userId: number;
  purpose: AuthTokenPurpose;
  ttlMinutes: number;
  maxUses?: number;
  withCode?: boolean;
  codeDigits?: number;
  createdByStaffId?: number | null;
  createdByMemberId?: number | null;
  meta?: Record<string, unknown>;
  /** Invalidate older unused tokens of the same purpose (default true). */
  supersede?: boolean;
};

export type IssuedToken = { id: number; raw: string; code: string | null; expiresAt: Date };

export async function issueAuthToken(tx: Tx, input: IssueInput, now = new Date()): Promise<IssuedToken> {
  if (input.supersede !== false) {
    await tx
      .update(portalAuthTokensTable)
      .set({ consumedAt: now })
      .where(
        and(
          eq(portalAuthTokensTable.userId, input.userId),
          eq(portalAuthTokensTable.purpose, input.purpose),
          isNull(portalAuthTokensTable.consumedAt),
        ),
      );
  }
  const raw = randomBytes(32).toString("base64url");
  const code = input.withCode ? generateNumericCode(input.codeDigits ?? 8) : null;
  const expiresAt = new Date(now.getTime() + input.ttlMinutes * 60_000);
  const [row] = await tx
    .insert(portalAuthTokensTable)
    .values({
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: hashToken(raw),
      codeHash: code ? hashCode(input.userId, code) : null,
      expiresAt,
      maxUses: input.maxUses ?? 1,
      createdByStaffId: input.createdByStaffId ?? null,
      createdByMemberId: input.createdByMemberId ?? null,
      meta: input.meta ?? {},
    })
    .returning({ id: portalAuthTokensTable.id });
  if (!row) throw new Error("تعذر إنشاء الرمز");
  return { id: row.id, raw, code, expiresAt };
}

export type TokenRow = typeof portalAuthTokensTable.$inferSelect;
export type TokenCheck =
  | { ok: true; token: TokenRow }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/** Read-only check (used by "preview" screens). Does not consume. */
export async function peekAuthToken(
  tx: Tx,
  raw: string,
  purposes: readonly AuthTokenPurpose[],
  now = new Date(),
): Promise<TokenCheck> {
  if (!raw || raw.length < 20 || raw.length > 200) return { ok: false, reason: "invalid" };
  const [row] = await tx
    .select()
    .from(portalAuthTokensTable)
    .where(eq(portalAuthTokensTable.tokenHash, hashToken(raw)))
    .limit(1);
  if (!row || !purposes.includes(row.purpose as AuthTokenPurpose)) return { ok: false, reason: "invalid" };
  if (row.consumedAt || row.uses >= row.maxUses) return { ok: false, reason: "used" };
  if (row.expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true, token: row };
}

/** Atomic single-statement consume: two parallel requests can never both win. */
export async function consumeAuthToken(
  tx: Tx,
  raw: string,
  purposes: readonly AuthTokenPurpose[],
  now = new Date(),
): Promise<TokenCheck> {
  const check = await peekAuthToken(tx, raw, purposes, now);
  if (!check.ok) return check;
  const [row] = await tx
    .update(portalAuthTokensTable)
    .set({
      uses: sql`${portalAuthTokensTable.uses} + 1`,
      consumedAt: sql`CASE WHEN ${portalAuthTokensTable.uses} + 1 >= ${portalAuthTokensTable.maxUses} THEN ${now.toISOString()}::timestamptz ELSE NULL END`,
    })
    .where(
      and(
        eq(portalAuthTokensTable.id, check.token.id),
        isNull(portalAuthTokensTable.consumedAt),
        sql`${portalAuthTokensTable.uses} < ${portalAuthTokensTable.maxUses}`,
        sql`${portalAuthTokensTable.expiresAt} > ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning();
  if (!row) return { ok: false, reason: "used" };
  return { ok: true, token: row };
}

/**
 * Verify a short code for a user. Wrong guesses count against the newest live
 * token (invalidated after CODE_MAX_ATTEMPTS). The match is atomic.
 */
export async function consumeShortCode(
  tx: Tx,
  userId: number,
  purpose: AuthTokenPurpose,
  code: string,
  now = new Date(),
  filter?: (t: TokenRow) => boolean,
): Promise<{ ok: true; token: TokenRow } | { ok: false; reason: "invalid" | "locked" }> {
  const rows = await tx
    .select()
    .from(portalAuthTokensTable)
    .where(
      and(
        eq(portalAuthTokensTable.userId, userId),
        eq(portalAuthTokensTable.purpose, purpose),
        isNull(portalAuthTokensTable.consumedAt),
        sql`${portalAuthTokensTable.codeHash} IS NOT NULL`,
        sql`${portalAuthTokensTable.expiresAt} > ${now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(portalAuthTokensTable.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row || (filter && !filter(row))) return { ok: false, reason: "invalid" };
  if (row.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, reason: "locked" };
  const match = safeEqualHex(row.codeHash ?? "", hashCode(userId, code));
  if (!match) {
    const attempts = row.attempts + 1;
    await tx
      .update(portalAuthTokensTable)
      .set({ attempts, ...(attempts >= CODE_MAX_ATTEMPTS ? { consumedAt: now } : {}) })
      .where(eq(portalAuthTokensTable.id, row.id));
    return { ok: false, reason: attempts >= CODE_MAX_ATTEMPTS ? "locked" : "invalid" };
  }
  const [won] = await tx
    .update(portalAuthTokensTable)
    .set({ consumedAt: now, uses: sql`${portalAuthTokensTable.uses} + 1` })
    .where(and(eq(portalAuthTokensTable.id, row.id), isNull(portalAuthTokensTable.consumedAt)))
    .returning();
  return won ? { ok: true, token: won } : { ok: false, reason: "invalid" };
}
