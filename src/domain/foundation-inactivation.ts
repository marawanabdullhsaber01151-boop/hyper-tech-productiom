/** @format */
/**
 * Phase 03 (delivery 1) — "Inactivation cannot silently break open work."
 *
 * Pure decision logic only. No database access here on purpose: the
 * counting queries (in ../lib/foundation-inactivation.ts) are the part that
 * needs a real PostgreSQL instance to verify; this module is a small,
 * dependency-free function that can be exhaustively unit tested without one.
 */

export type InactivationBlocker = {
  /** Stable machine key, e.g. "child_locations", "active_inventory_balance". */
  type: string;
  count: number;
  /** Arabic label shown in the UI/error payload. */
  label: string;
};

export type InactivationImpact = {
  entityType: string;
  entityId: number;
  blockers: InactivationBlocker[];
};

export function isInactivationBlocked(impact: InactivationImpact): boolean {
  return impact.blockers.some((blocker) => blocker.count > 0);
}

export function activeBlockers(
  impact: InactivationImpact,
): InactivationBlocker[] {
  return impact.blockers.filter((blocker) => blocker.count > 0);
}

/**
 * Throws unless there are no active blockers, or the caller supplied an
 * explicit override reason (an "impact decision", per Phase 03's acceptance
 * criterion — not a silent bypass: the reason is written to
 * foundation_audit by the route, same as every other foundation mutation).
 */
export function assertInactivationAllowed(
  impact: InactivationImpact,
  overrideReason: string | null | undefined,
): void {
  const blockers = activeBlockers(impact);
  if (blockers.length === 0) return;
  if (overrideReason && overrideReason.trim().length >= 3) return;
  throw Object.assign(
    new Error(
      "لا يمكن إلغاء تفعيل هذا السجل لوجود مراجع نشطة تعتمد عليه — أضف overrideReason صريحًا لتأكيد القرار",
    ),
    {
      status: 409,
      code: "INACTIVATION_BLOCKED",
      // Matches the existing domain-error contract in
      // src/middleware/errorHandler.ts, which serializes `details` (not an
      // arbitrary custom field) into the JSON error envelope.
      details: blockers,
    },
  );
}
