/** @format */

// Phase 6 (Governance & Portal project) — resolving the final price for a
// price inquiry. Pure function so the "accept suggested as-is" vs
// "sales typed an override" rule is unit-testable without a database.

/**
 * If the sales person answers without changing anything, the snapshotted
 * suggested price becomes the final price. If they provide their own value,
 * that value wins instead — regardless of what the suggested price was.
 */
export function resolveFinalPrice(
  suggestedPrice: string | null,
  overridePrice: string | null | undefined,
): string | null {
  if (overridePrice !== undefined && overridePrice !== null && overridePrice !== "") {
    return overridePrice;
  }
  return suggestedPrice;
}
