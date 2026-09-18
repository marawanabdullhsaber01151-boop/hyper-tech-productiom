/** @format */

// Phase 7 (Governance & Portal project) — batch lookup of each portal
// customer's assigned salesperson, for the combined sales workspace.
//
// Performance: ONE query with an IN(...) list, never a query per row. Used
// by both the pending-orders and pending-price-inquiries lists so neither
// screen turns into an N+1 join as the list grows.

import { inArray, eq } from "drizzle-orm";
import { db } from "../db";
import { portalCustomersTable, systemUsersTable } from "../db/schema";

export type AssignedSalesInfo = { userId: number; name: string } | null;

export async function getAssignedSalesByCustomerId(
  customerIds: number[],
): Promise<Map<number, AssignedSalesInfo>> {
  const result = new Map<number, AssignedSalesInfo>();
  const uniqueIds = [...new Set(customerIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (!uniqueIds.length) return result;

  const rows = await db
    .select({
      customerId: portalCustomersTable.id,
      salesUserId: systemUsersTable.id,
      salesUserName: systemUsersTable.fullName,
    })
    .from(portalCustomersTable)
    .leftJoin(
      systemUsersTable,
      eq(systemUsersTable.id, portalCustomersTable.assignedSalesUserId),
    )
    .where(inArray(portalCustomersTable.id, uniqueIds));

  for (const row of rows) {
    result.set(
      row.customerId,
      row.salesUserId ? { userId: row.salesUserId, name: row.salesUserName! } : null,
    );
  }
  return result;
}
