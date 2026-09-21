/** @format */
/**
 * Phase 03 (delivery 3) — DB-aware side of governed master data. Pure rules
 * live in ../domain/foundation-governance.ts; this file only does queries.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  foundationItemsTable,
  foundationItemVersionsTable,
  foundationItemAliasesTable,
} from "../db/schema/foundation";

// Matches the loose structural transaction type already used in
// ../lib/production-lifecycle-transition.ts, rather than `typeof db`: a
// drizzle transaction callback's `tx` parameter is not exactly `typeof db`,
// and this repo already works around that mismatch the same way.
type Executor = {
  select: (...args: any[]) => any;
  update: (...args: any[]) => any;
  insert: (...args: any[]) => any;
  execute: <T = any>(...args: any[]) => Promise<{ rows: T[] }>;
};

/**
 * Records the *before* snapshot of an item as its current version, ahead of
 * an update that will bump the live row to version + 1. Must be called
 * inside the same transaction as the update it precedes so the two never
 * disagree about what "version N" looked like.
 */
export async function recordFoundationItemVersion(
  tx: Executor,
  before: typeof foundationItemsTable.$inferSelect,
  changedById: string | null,
  changedByName: string | null,
  changeReason: string | null,
) {
  await tx.insert(foundationItemVersionsTable).values({
    itemId: before.id,
    version: before.version,
    snapshot: before,
    changedById,
    changedByName,
    changeReason,
  });
}

export async function listFoundationItemHistory(
  executor: Executor,
  itemId: number,
  limit = 50,
) {
  return executor
    .select()
    .from(foundationItemVersionsTable)
    .where(eq(foundationItemVersionsTable.itemId, itemId))
    .orderBy(sql`${foundationItemVersionsTable.version} desc`)
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function listFoundationItemAliases(
  executor: Executor,
  itemId: number,
) {
  return executor
    .select()
    .from(foundationItemAliasesTable)
    .where(eq(foundationItemAliasesTable.itemId, itemId))
    .orderBy(foundationItemAliasesTable.alias);
}

/**
 * Duplicate-name groups among non-retired items, using the indexed
 * name_normalized generated column (see migration 0063) rather than
 * pulling every row into the application to normalize in JS — this stays
 * an index-assisted GROUP BY even as the item catalog grows. Bounded to
 * `limit` groups so a badly-duplicated catalog cannot return an unbounded
 * response.
 *
 * name_normalized is a SQL approximation of
 * normalizeForDuplicateMatch() in ../domain/foundation-governance.ts; the
 * two are not called from the same code path, so a future edit to one
 * without the other would silently desynchronize them. There is no
 * automated guard against that drift in this delivery — see the phase 03
 * delivery 3 report for why, and what would close it.
 */
export async function findDuplicateFoundationItemGroups(
  executor: Executor,
  limit = 50,
) {
  const result = await executor.execute<{
    name_normalized: string;
    item_ids: number[];
    codes: string[];
    names: string[];
  }>(sql`
    select
      name_normalized,
      array_agg(id order by id) as item_ids,
      array_agg(code order by id) as codes,
      array_agg(name order by id) as names
    from foundation_items
    where status <> 'retired'
    group by name_normalized
    having count(*) > 1
    order by name_normalized
    limit ${Math.min(Math.max(limit, 1), 200)}
  `);
  return result.rows;
}

export async function findDuplicateFoundationItemCodeGroups(
  executor: Executor,
  limit = 50,
) {
  const result = await executor.execute<{
    normalized_code: string;
    item_ids: number[];
  }>(sql`
    select lower(code) as normalized_code, array_agg(id order by id) as item_ids
    from foundation_items
    where status <> 'retired'
    group by lower(code)
    having count(*) > 1
    limit ${Math.min(Math.max(limit, 1), 200)}
  `);
  return result.rows;
}
