/** @format */
/**
 * Phase 03 (delivery 1) — impact counter for the item inactivation guard (المواقع ومراكز العمل والماكينات والورديات انتقلت لـ foundation-impact.ts في الخطوة 35).
 * Original note: Each function counts only relationships that are already declared
 * and verified in the schema (foundation_locations.parent_id,
 * foundation_work_centers.location_id, foundation_machines.work_center_id,
 * inventory_items.foundation_item_id from migration 0021). Deliberately not
 * included: BOM/routing/engineering references to a foundation item, since
 * that linkage belongs to the Engineering domain (Phase 04) and has not been
 * inspected as part of this delivery — see the Phase 03 delivery-1 report
 * for the exact list of what this guard does and does not cover yet.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { inventoryItemsTable } from "../db/schema/inventory";
import type { InactivationImpact } from "../domain/foundation-inactivation";

type Executor = typeof db;

export async function checkItemInactivationImpact(
  executor: Executor,
  itemId: number,
): Promise<InactivationImpact> {
  const [{ value }] = await executor
    .select({ value: sql<number>`count(*)::int` })
    .from(inventoryItemsTable)
    .where(
      and(
        eq(inventoryItemsTable.foundationItemId, itemId),
        sql`(${inventoryItemsTable.qty}::numeric > 0 or ${inventoryItemsTable.reservedQty}::numeric > 0 or ${inventoryItemsTable.quarantineQty}::numeric > 0)`,
      ),
    );
  return {
    entityType: "item",
    entityId: itemId,
    blockers: [
      {
        type: "active_inventory_balance",
        count: value,
        label: "أرصدة مخزون مرتبطة بهذا الصنف (متاحة أو محجوزة أو محجورة)",
      },
    ],
  };
}
