/** @format */
/**
 * Per-company activity log shown to the owner. Never put passwords, tokens,
 * activation links or the company code itself in `before` / `after`.
 */
import { db } from "../db";
import { portalAuditEventsTable } from "../db/schema";

type Tx = Pick<typeof db, "insert">;

const FORBIDDEN_KEYS = /pass|token|secret|hash|code$|link|url/i;

/** Drops anything that looks like a secret, defensively (deep, objects only). */
export function scrubAuditData(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return depth > 4 ? [] : value.map((v) => scrubAuditData(v, depth + 1));
  if (typeof value === "object") {
    if (depth > 4) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.test(k)) continue;
      out[k] = scrubAuditData(v, depth + 1);
    }
    return out;
  }
  return value;
}

export async function writePortalAudit(
  tx: Tx,
  event: {
    companyId: number;
    actorMemberId?: number | null;
    actorStaffUserId?: number | null;
    actorLabel: string;
    action: string;
    targetType?: string;
    targetId?: string | number;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  await tx.insert(portalAuditEventsTable).values({
    companyId: event.companyId,
    actorMemberId: event.actorMemberId ?? null,
    actorStaffUserId: event.actorStaffUserId ?? null,
    actorLabel: event.actorLabel,
    action: event.action,
    targetType: event.targetType ?? null,
    targetId: event.targetId === undefined ? null : String(event.targetId),
    before: scrubAuditData(event.before) as never,
    after: scrubAuditData(event.after) as never,
    ip: event.ip ?? null,
    userAgent: event.userAgent?.slice(0, 200) ?? null,
  });
}
