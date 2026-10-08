/** @format */
/**
 * Company join code: HT-XXXX-XXXX
 *  - 7 random Crockford-base32 characters + 1 check character (8 shown).
 *  - Alphabet excludes I, L, O, U so it can be read over the phone.
 *  - The check character lets us reject typos before touching the database.
 * The raw code is a secret-ish identifier: never log it.
 */
import { randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { portalCompanyCodesTable } from "../db/schema";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 chars
export const COMPANY_CODE_PREFIX = "HT";

function checkChar(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    sum += ALPHABET.indexOf(body[i]!) * (i + 3);
  }
  return ALPHABET[sum % 32]!;
}

/** Plain 8-char form without prefix/dashes (what we store). */
export function generateRawCompanyCode(): string {
  let body = "";
  for (let i = 0; i < 7; i += 1) body += ALPHABET[randomInt(32)];
  return body + checkChar(body);
}

/** Display form: HT-XXXX-XXXX */
export function formatCompanyCode(raw: string): string {
  return `${COMPANY_CODE_PREFIX}-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

/**
 * Accepts what a person might type: any case, spaces/dashes, optional HT prefix,
 * and the confusable letters O→0, I/L→1, U→V. Returns the 8-char raw code or
 * null if it is malformed or the check character is wrong.
 */
export function normalizeCompanyCode(input: string | null | undefined): string | null {
  let value = (input ?? "").toUpperCase().replace(/[\s\-_.]/g, "");
  if (value.startsWith(COMPANY_CODE_PREFIX) && value.length === 10) value = value.slice(2);
  value = value.replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");
  if (value.length !== 8) return null;
  for (const ch of value) if (!ALPHABET.includes(ch)) return null;
  if (checkChar(value.slice(0, 7)) !== value[7]) return null;
  return value;
}

type Tx = Pick<typeof db, "select" | "insert" | "update">;

export type CodeActor = { memberId?: number | null; staffUserId?: number | null };

/**
 * Revokes the active code (if any) and creates a new one. Used for the first
 * code of a company and for "rotate" (reason recorded). Returns the raw code
 * — show it only to someone allowed to manage the code.
 */
export async function generateCompanyCode(
  tx: Tx,
  companyId: number,
  actor: CodeActor,
  reason = "rotated",
): Promise<{ id: number; code: string }> {
  await tx
    .update(portalCompanyCodesTable)
    .set({ status: "revoked", revokedAt: new Date(), revokeReason: reason })
    .where(
      and(
        eq(portalCompanyCodesTable.companyId, companyId),
        eq(portalCompanyCodesTable.status, "active"),
      ),
    );
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateRawCompanyCode();
    const [taken] = await tx
      .select({ id: portalCompanyCodesTable.id })
      .from(portalCompanyCodesTable)
      .where(eq(portalCompanyCodesTable.code, code))
      .limit(1);
    if (taken) continue;
    const [row] = await tx
      .insert(portalCompanyCodesTable)
      .values({
        companyId,
        code,
        createdByMemberId: actor.memberId ?? null,
        createdByStaffId: actor.staffUserId ?? null,
      })
      .returning({ id: portalCompanyCodesTable.id });
    if (row) return { id: row.id, code };
  }
  throw new Error("تعذر توليد كود شركة فريد");
}

export async function getActiveCompanyCode(
  tx: Pick<typeof db, "select">,
  companyId: number,
) {
  const [row] = await tx
    .select()
    .from(portalCompanyCodesTable)
    .where(
      and(
        eq(portalCompanyCodesTable.companyId, companyId),
        eq(portalCompanyCodesTable.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type CodeLookup =
  | { ok: true; companyId: number; codeId: number }
  | { ok: false; reason: "malformed" | "unknown" | "revoked" | "expired" | "exhausted" };

/** Finds a usable code. `uses` is only incremented by consumeCompanyCode. */
export async function lookupCompanyCode(
  tx: Pick<typeof db, "select">,
  input: string,
  now = new Date(),
): Promise<CodeLookup> {
  const raw = normalizeCompanyCode(input);
  if (!raw) return { ok: false, reason: "malformed" };
  const [row] = await tx
    .select()
    .from(portalCompanyCodesTable)
    .where(eq(portalCompanyCodesTable.code, raw))
    .limit(1);
  if (!row) return { ok: false, reason: "unknown" };
  if (row.status !== "active") return { ok: false, reason: "revoked" };
  if (row.expiresAt && row.expiresAt <= now) return { ok: false, reason: "expired" };
  if (row.maxUses !== null && row.uses >= row.maxUses) return { ok: false, reason: "exhausted" };
  return { ok: true, companyId: row.companyId, codeId: row.id };
}

/** Atomically counts a use; returns false if the limit was reached meanwhile. */
export async function consumeCompanyCode(
  tx: Pick<typeof db, "update">,
  codeId: number,
): Promise<boolean> {
  const rows = await tx
    .update(portalCompanyCodesTable)
    .set({ uses: sql`${portalCompanyCodesTable.uses} + 1` })
    .where(
      and(
        eq(portalCompanyCodesTable.id, codeId),
        eq(portalCompanyCodesTable.status, "active"),
        sql`(${portalCompanyCodesTable.maxUses} IS NULL OR ${portalCompanyCodesTable.uses} < ${portalCompanyCodesTable.maxUses})`,
      ),
    )
    .returning({ id: portalCompanyCodesTable.id });
  return rows.length === 1;
}
