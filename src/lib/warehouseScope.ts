/** @format */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { warehouseKeepersTable } from "../db/schema";
import { scopeFor } from "./warehouseAccess";

/** نطاق المخازن لمستخدم: أمين المخزن المعيّن بيشتغل في مخازنه بس، والباقي الكل. */
export async function warehouseScopeOf(role: string, userId: number): Promise<"all" | number[]> {
  if (role !== "storekeeper") return "all";
  const rows = await db.select({ id: warehouseKeepersTable.warehouseId }).from(warehouseKeepersTable).where(eq(warehouseKeepersTable.userId, userId));
  return scopeFor(role, rows.map((r) => r.id));
}
