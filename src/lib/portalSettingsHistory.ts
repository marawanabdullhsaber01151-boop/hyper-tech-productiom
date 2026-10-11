/** @format */
/**
 * "Who changed what and when" for portal settings, plus one-step revert.
 * Secrets never live in settings, but values are still length-capped on read.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { portalSettingsHistoryTable, portalSettingsTable } from "../db/schema";
import {
  clearSetting,
  getSettingDef,
  SettingScope,
  validateSettingWrite,
  writeSetting,
} from "./portalSettings";
import { domainError } from "./portalTeam";

type Tx = Pick<typeof db, "select" | "insert" | "execute" | "delete">;

export async function readStoredSetting(
  tx: Pick<typeof db, "select">,
  scope: SettingScope,
  scopeId: number | null,
  key: string,
): Promise<{ exists: boolean; value: unknown }> {
  const [row] = await tx
    .select({ value: portalSettingsTable.value })
    .from(portalSettingsTable)
    .where(
      and(
        eq(portalSettingsTable.scope, scope),
        eq(portalSettingsTable.key, key),
        scopeId === null ? sql`${portalSettingsTable.scopeId} IS NULL` : eq(portalSettingsTable.scopeId, scopeId),
      ),
    )
    .limit(1);
  return row ? { exists: true, value: row.value } : { exists: false, value: null };
}

/** Writes (or clears) a setting and records the change in one go. */
export async function changeSetting(
  tx: Tx,
  input: {
    scope: SettingScope;
    scopeId: number | null;
    key: string;
    value?: unknown;
    reset?: boolean;
    by: string;
    revertedOf?: number;
  },
): Promise<void> {
  const before = await readStoredSetting(tx, input.scope, input.scopeId, input.key);
  let after: unknown = null;
  if (input.reset) {
    await clearSetting(tx, { key: input.key, scope: input.scope, scopeId: input.scopeId });
  } else {
    after = validateSettingWrite(input.key, input.scope, input.value, "staff");
    await writeSetting(tx, {
      key: input.key,
      scope: input.scope,
      scopeId: input.scopeId,
      value: after,
      updatedBy: input.by,
    });
  }
  await tx.insert(portalSettingsHistoryTable).values({
    scope: input.scope,
    scopeId: input.scopeId,
    key: input.key,
    beforeValue: before.exists ? (before.value as never) : null,
    afterValue: input.reset ? null : (after as never),
    hadBefore: before.exists,
    hasAfter: !input.reset,
    changedBy: input.by,
    revertedOf: input.revertedOf ?? null,
  });
}

export async function listSettingHistory(
  scope: SettingScope,
  scopeId: number | null,
  limit = 50,
) {
  return db
    .select()
    .from(portalSettingsHistoryTable)
    .where(
      and(
        eq(portalSettingsHistoryTable.scope, scope),
        scopeId === null
          ? sql`${portalSettingsHistoryTable.scopeId} IS NULL`
          : eq(portalSettingsHistoryTable.scopeId, scopeId),
      ),
    )
    .orderBy(desc(portalSettingsHistoryTable.id))
    .limit(Math.min(limit, 200));
}

/** Puts the setting back to what it was before history row `historyId`. */
export async function revertSettingChange(
  tx: Tx & Pick<typeof db, "select">,
  historyId: number,
  by: string,
  expect: { scope: SettingScope; scopeId: number | null },
) {
  const [row] = await tx
    .select()
    .from(portalSettingsHistoryTable)
    .where(eq(portalSettingsHistoryTable.id, historyId))
    .limit(1);
  if (!row || row.scope !== expect.scope || (row.scopeId ?? null) !== expect.scopeId) {
    throw domainError(404, "HISTORY_NOT_FOUND", "التغيير ده مش موجود");
  }
  if (!getSettingDef(row.key)) throw domainError(400, "INVALID_SETTING", "الإعداد ده مش موجود");
  await changeSetting(tx, {
    scope: expect.scope,
    scopeId: expect.scopeId,
    key: row.key,
    value: row.beforeValue,
    reset: !row.hadBefore,
    by,
    revertedOf: row.id,
  });
  return row.key;
}
