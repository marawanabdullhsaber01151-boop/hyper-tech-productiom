/** @format */
/** One-time recovery codes: 8 codes shown once, stored only as keyed hashes. */
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { portalRecoveryCodesTable } from "../db/schema";
import { hashCode } from "./authTokens";

type Tx = Pick<typeof db, "select" | "insert" | "update" | "delete">;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export const RECOVERY_CODE_COUNT = 8;

export function makeRecoveryCode(): string {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i]! % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/** Replaces every previous code of the user. Returns the plain codes ONCE. */
export async function regenerateRecoveryCodes(tx: Tx, userId: number): Promise<string[]> {
  await tx.delete(portalRecoveryCodesTable).where(eq(portalRecoveryCodesTable.userId, userId));
  const batchId = randomUUID();
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, makeRecoveryCode);
  await tx.insert(portalRecoveryCodesTable).values(
    codes.map((c) => ({ userId, codeHash: hashCode(userId, c), batchId })),
  );
  return codes;
}

export async function countUnusedRecoveryCodes(tx: Tx, userId: number): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(portalRecoveryCodesTable)
    .where(and(eq(portalRecoveryCodesTable.userId, userId), isNull(portalRecoveryCodesTable.usedAt)));
  return r?.n ?? 0;
}

/** Atomic: a code can be used exactly once even under parallel requests. */
export async function useRecoveryCode(tx: Tx, userId: number, code: string, now = new Date()): Promise<boolean> {
  const [row] = await tx
    .update(portalRecoveryCodesTable)
    .set({ usedAt: now })
    .where(
      and(
        eq(portalRecoveryCodesTable.userId, userId),
        eq(portalRecoveryCodesTable.codeHash, hashCode(userId, code)),
        isNull(portalRecoveryCodesTable.usedAt),
      ),
    )
    .returning({ id: portalRecoveryCodesTable.id });
  return Boolean(row);
}
