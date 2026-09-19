/** @format */
/**
 * Phase 03 (delivery 1) — impact counters for the master-data inactivation
 * guard. Each function counts only relationships that are already declared
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
import {
  foundationLocationsTable,
  foundationWorkCentersTable,
  foundationMachinesTable,
} from "../db/schema/foundation";
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

export async function checkLocationInactivationImpact(
  executor: Executor,
  locationId: number,
): Promise<InactivationImpact> {
  const [[{ value: childLocations }], [{ value: workCenters }]] =
    await Promise.all([
      executor
        .select({ value: sql<number>`count(*)::int` })
        .from(foundationLocationsTable)
        .where(
          and(
            eq(foundationLocationsTable.parentId, locationId),
            eq(foundationLocationsTable.active, true),
          ),
        ),
      executor
        .select({ value: sql<number>`count(*)::int` })
        .from(foundationWorkCentersTable)
        .where(
          and(
            eq(foundationWorkCentersTable.locationId, locationId),
            eq(foundationWorkCentersTable.active, true),
          ),
        ),
    ]);
  return {
    entityType: "location",
    entityId: locationId,
    blockers: [
      {
        type: "child_locations",
        count: childLocations,
        label: "مواقع فرعية نشطة تحت هذا الموقع",
      },
      {
        type: "work_centers",
        count: workCenters,
        label: "مراكز عمل نشطة مرتبطة بهذا الموقع",
      },
    ],
  };
}

export async function checkWorkCenterInactivationImpact(
  executor: Executor,
  workCenterId: number,
): Promise<InactivationImpact> {
  const [{ value }] = await executor
    .select({ value: sql<number>`count(*)::int` })
    .from(foundationMachinesTable)
    .where(
      and(
        eq(foundationMachinesTable.workCenterId, workCenterId),
        eq(foundationMachinesTable.active, true),
      ),
    );
  return {
    entityType: "work_center",
    entityId: workCenterId,
    blockers: [
      {
        type: "machines",
        count: value,
        label: "ماكينات نشطة مرتبطة بمركز العمل هذا",
      },
    ],
  };
}
