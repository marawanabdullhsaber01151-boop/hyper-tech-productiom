/** @format */
import { randomInt } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { portalMembersTable } from "../db/schema";
import { resolveSetting } from "./portalSettings";

export function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i += 1) out += chars[randomInt(chars.length)];
  return out;
}

export function domainError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code });
}

/** Members that occupy a seat: active, invited and waiting for approval. */
export async function countSeats(
  tx: Pick<typeof db, "select">,
  companyId: number,
): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(portalMembersTable)
    .where(
      and(
        eq(portalMembersTable.companyId, companyId),
        inArray(portalMembersTable.status, ["active", "invited", "pending_approval"]),
      ),
    );
  return row?.n ?? 0;
}

export async function assertSeatAvailable(
  tx: Pick<typeof db, "select">,
  companyId: number,
): Promise<void> {
  const [max, used] = await Promise.all([
    resolveSetting<number>("team.max_members", { companyId }, tx),
    countSeats(tx, companyId),
  ]);
  if (used >= max) {
    throw domainError(409, "TEAM_FULL", `وصلت للحد الأقصى للفريق (${max}). كلّم الإدارة لو محتاج زيادة`);
  }
}

/** Limits object accepted from the client: positive numbers only, known keys only. */
export function sanitizeLimits(input: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== "object") return out;
  for (const key of ["maxQtyPerLine", "maxLinesPerOrder", "maxOrdersPerDay", "maxOrderValue"]) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[key] = v;
  }
  return out;
}
