/** @format */
/**
 * محاكي الأثر (خطوة 35): قبل أي إيقاف لموقع/مركز عمل/ماكينة/وردية، نقول إيه اللي هيتأثر وبالأسماء.
 * قراءة فقط. بيفرّق بين:
 *  - blockers: مراجع حيّة بتمنع الإيقاف إلا بسبب صريح (نفس سياسة assertInactivationAllowed).
 *  - references: مراجع تاريخية/مسودات للعلم بس (مش بتمنع).
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  foundationLocationsTable,
  foundationMachinesTable,
  foundationShiftsTable,
  foundationWorkCentersTable,
} from "../db/schema/foundation";
import { engineeringProductVersionsTable, engineeringRoutingsTable } from "../db/schema/engineering";
import { planningCapacityLoadsTable } from "../db/schema/planning";
import { productionOperationConfirmationsTable } from "../db/schema/production-execution";

export type ImpactExecutor = Pick<typeof db, "select">;
export const IMPACT_KINDS = ["location", "work-center", "machine", "shift"] as const;
export type ImpactKind = (typeof IMPACT_KINDS)[number];

export type ImpactLine = { type: string; count: number; label: string; examples: string[] };
export type FoundationImpact = {
  kind: ImpactKind;
  id: number;
  name: string;
  active: boolean;
  blockers: ImpactLine[];
  references: ImpactLine[];
};

const EXAMPLES = 5;
const line = (type: string, label: string, names: string[], count = names.length): ImpactLine => ({ type, count, label, examples: names.slice(0, EXAMPLES) });
const named = (rows: Array<{ code: string; name: string }>) => rows.map((r) => `${r.code} - ${r.name}`);

async function routingRefs(ex: ImpactExecutor, column: "work_center_id" | "machine_id", id: number) {
  const col = column === "work_center_id" ? engineeringRoutingsTable.workCenterId : engineeringRoutingsTable.machineId;
  const rows = await ex
    .select({ version: engineeringProductVersionsTable.version, status: engineeringProductVersionsTable.status, op: engineeringRoutingsTable.operationNo, name: engineeringRoutingsTable.name })
    .from(engineeringRoutingsTable)
    .innerJoin(engineeringProductVersionsTable, eq(engineeringRoutingsTable.productVersionId, engineeringProductVersionsTable.id))
    .where(eq(col, id))
    .orderBy(asc(engineeringProductVersionsTable.id), asc(engineeringRoutingsTable.operationNo));
  const label = (r: (typeof rows)[number]) => `إصدار ${r.version} - عملية ${r.op} (${r.name})`;
  return { live: rows.filter((r) => r.status === "released").map(label), other: rows.filter((r) => r.status !== "released").map(label) };
}

const count = async (ex: ImpactExecutor, q: PromiseLike<Array<{ value: number }>>) => (await q)[0]?.value ?? 0;

export async function foundationImpact(ex: ImpactExecutor, kind: ImpactKind, id: number): Promise<FoundationImpact | null> {
  if (kind === "location") {
    const [row] = await ex.select().from(foundationLocationsTable).where(eq(foundationLocationsTable.id, id));
    if (!row) return null;
    const [children, centers] = await Promise.all([
      ex.select({ code: foundationLocationsTable.code, name: foundationLocationsTable.name }).from(foundationLocationsTable).where(and(eq(foundationLocationsTable.parentId, id), eq(foundationLocationsTable.active, true))),
      ex.select({ code: foundationWorkCentersTable.code, name: foundationWorkCentersTable.name }).from(foundationWorkCentersTable).where(and(eq(foundationWorkCentersTable.locationId, id), eq(foundationWorkCentersTable.active, true))),
    ]);
    return {
      kind, id, name: row.name, active: row.active,
      blockers: [line("child_locations", "مواقع فرعية نشطة تحت هذا الموقع", named(children)), line("work_centers", "مراكز عمل نشطة مرتبطة بهذا الموقع", named(centers))],
      references: [],
    };
  }
  if (kind === "work-center") {
    const [row] = await ex.select().from(foundationWorkCentersTable).where(eq(foundationWorkCentersTable.id, id));
    if (!row) return null;
    const [machines, routing, loads] = await Promise.all([
      ex.select({ code: foundationMachinesTable.code, name: foundationMachinesTable.name }).from(foundationMachinesTable).where(and(eq(foundationMachinesTable.workCenterId, id), eq(foundationMachinesTable.active, true))),
      routingRefs(ex, "work_center_id", id),
      count(ex, ex.select({ value: sql<number>`count(*)::int` }).from(planningCapacityLoadsTable).where(eq(planningCapacityLoadsTable.workCenterId, id))),
    ]);
    return {
      kind, id, name: row.name, active: row.active,
      blockers: [line("machines", "ماكينات نشطة مرتبطة بمركز العمل هذا", named(machines)), line("live_routing", "مسارات تشغيل في إصدارات هندسية مُصدرة", routing.live)],
      references: [line("draft_routing", "مسارات تشغيل في إصدارات غير مُصدرة", routing.other), line("capacity_loads", "سجلات ضغط طاقة في سيناريوهات تخطيط سابقة", [], loads)],
    };
  }
  if (kind === "machine") {
    const [row] = await ex.select().from(foundationMachinesTable).where(eq(foundationMachinesTable.id, id));
    if (!row) return null;
    const [routing, confirmations, loads] = await Promise.all([
      routingRefs(ex, "machine_id", id),
      count(ex, ex.select({ value: sql<number>`count(*)::int` }).from(productionOperationConfirmationsTable).where(eq(productionOperationConfirmationsTable.machineId, id))),
      count(ex, ex.select({ value: sql<number>`count(*)::int` }).from(planningCapacityLoadsTable).where(eq(planningCapacityLoadsTable.machineId, id))),
    ]);
    return {
      kind, id, name: row.name, active: row.active,
      blockers: [line("live_routing", "مسارات تشغيل في إصدارات هندسية مُصدرة", routing.live)],
      references: [line("draft_routing", "مسارات تشغيل في إصدارات غير مُصدرة", routing.other), line("confirmations", "تأكيدات عمليات إنتاج اتسجّلت عليها", [], confirmations), line("capacity_loads", "سجلات ضغط طاقة سابقة", [], loads)],
    };
  }
  const [row] = await ex.select().from(foundationShiftsTable).where(eq(foundationShiftsTable.id, id));
  if (!row) return null;
  const [others, loads] = await Promise.all([
    count(ex, ex.select({ value: sql<number>`count(*)::int` }).from(foundationShiftsTable).where(and(eq(foundationShiftsTable.active, true), ne(foundationShiftsTable.id, id)))),
    count(ex, ex.select({ value: sql<number>`count(*)::int` }).from(planningCapacityLoadsTable).where(eq(planningCapacityLoadsTable.shiftId, id))),
  ]);
  return {
    kind, id, name: row.name, active: row.active,
    blockers: [line("last_shift", "ده آخر وردية نشطة: بعدها مفيش وردية تتحسب عليها الطاقة", [], row.active && others === 0 ? 1 : 0)],
    references: [line("capacity_loads", "سجلات ضغط طاقة سابقة", [], loads)],
  };
}

export const hasBlockers = (i: Pick<FoundationImpact, "blockers">) => i.blockers.some((b) => b.count > 0);
