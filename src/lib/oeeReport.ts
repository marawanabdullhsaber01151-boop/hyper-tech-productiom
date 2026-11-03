/** @format */
// تقرير OEE بالماكينة (الخطوة 37ب): بيجمع الورديات والتوقفات والتأكيدات ويسلّمها للحساب النقي في domain/oee.ts.
import { and, eq, gte, inArray, isNotNull, isNull, lt, ne, or, gt } from "drizzle-orm";
import { db } from "../db";
import { foundationMachinesTable, foundationShiftsTable, productionDowntimesTable, productionOperationConfirmationsTable, productionWorkflowOrdersTable } from "../db/schema";
import { calcOee, overlapMinutes, reportRange, shiftNetMinutes, workingDays, type OeeResult } from "../domain/oee";

export interface MachineOee extends OeeResult {
  machineId: number;
  code: string;
  name: string;
  stoppages: number;
  openStoppage: boolean;
  /** عدد التأكيدات اللي ماعندهاش زمن تشغيل معياري في مسار التشغيل (لو > 0 الأداء مش بيتحسب). */
  missingStandards: number;
}
export interface OeeReport {
  from: string;
  to: string;
  workingDays: number;
  dailyShiftMinutes: number;
  machines: MachineOee[];
  total: OeeResult & { missingStandards: number; stoppages: number };
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** دقايق التشغيل المعيارية للوحدة لعملية في لقطة مسار التشغيل (بيقبل camelCase وsnake_case). */
export function standardRunMinutes(routing: unknown, operationNo: number): number {
  if (!Array.isArray(routing)) return 0;
  for (const op of routing as Array<Record<string, unknown>>) {
    if (op && num(op.operationNo ?? op.operation_no) === operationNo) return num(op.runMinutesPerUnit ?? op.run_minutes_per_unit);
  }
  return 0;
}

type Ex = Pick<typeof db, "select">;

export async function buildOeeReport(fromStr: string, toStr: string, now = new Date(), ex: Ex = db): Promise<OeeReport | null> {
  const range = reportRange(fromStr, toStr);
  if (!range) return null;
  const { from, to } = range;

  const shifts = await ex.select().from(foundationShiftsTable).where(eq(foundationShiftsTable.active, true));
  const dailyShiftMinutes = shifts.reduce((n, s) => n + shiftNetMinutes(s.startTime, s.endTime, s.breakMinutes), 0);
  const days = workingDays(fromStr, toStr);
  const planned = dailyShiftMinutes * days;

  const machines = await ex
    .select({ id: foundationMachinesTable.id, code: foundationMachinesTable.code, name: foundationMachinesTable.name })
    .from(foundationMachinesTable)
    .where(and(eq(foundationMachinesTable.active, true), ne(foundationMachinesTable.status, "retired")))
    .orderBy(foundationMachinesTable.code);

  const stops = await ex
    .select()
    .from(productionDowntimesTable)
    .where(and(isNotNull(productionDowntimesTable.machineId), lt(productionDowntimesTable.createdAt, to), or(isNull(productionDowntimesTable.endedAt), gt(productionDowntimesTable.endedAt, from))));

  const confirms = await ex
    .select()
    .from(productionOperationConfirmationsTable)
    .where(and(isNotNull(productionOperationConfirmationsTable.machineId), gte(productionOperationConfirmationsTable.createdAt, from), lt(productionOperationConfirmationsTable.createdAt, to)));
  const orderIds = [...new Set(confirms.map((c) => c.workflowOrderId))];
  const orders = orderIds.length ? await ex.select({ id: productionWorkflowOrdersTable.id, routing: productionWorkflowOrdersTable.routingSnapshot }).from(productionWorkflowOrdersTable).where(inArray(productionWorkflowOrdersTable.id, orderIds)) : [];
  const routingOf = new Map(orders.map((o) => [o.id, o.routing]));

  const rows: MachineOee[] = machines.map((m) => {
    let down = 0;
    let count = 0;
    let open = false;
    for (const s of stops.filter((x) => x.machineId === m.id)) {
      if (s.startedAt) {
        const mins = overlapMinutes(s.startedAt, s.endedAt, from, to, now);
        if (mins > 0) { down += mins; count += 1; }
        if (!s.endedAt) open = true;
      } else if (s.createdAt >= from && s.createdAt < to) {
        down += s.minutes;
        count += 1;
      }
    }
    let good = 0, scrap = 0, rework = 0, ideal = 0, missing = 0;
    for (const c of confirms.filter((x) => x.machineId === m.id)) {
      const g = num(c.goodQty), s = num(c.scrapQty), r = num(c.reworkQty);
      good += g; scrap += s; rework += r;
      if (g + s + r <= 0) continue;
      const std = standardRunMinutes(routingOf.get(c.workflowOrderId), c.operationNo);
      if (std > 0) ideal += (g + s + r) * std; else missing += 1;
    }
    const result = calcOee({ plannedMinutes: planned, downtimeMinutes: down, idealMinutes: missing > 0 ? null : good + scrap + rework > 0 ? ideal : null, good, scrap, rework });
    return { machineId: m.id, code: m.code, name: m.name, stoppages: count, openStoppage: open, missingStandards: missing, ...result };
  });

  // الإجمالي من المجاميع (مش متوسط نسب): مخطط وتوقف كل الماكينات، وإنتاجها
  const sum = (f: (r: MachineOee) => number) => rows.reduce((n, r) => n + f(r), 0);
  const missingAll = sum((r) => r.missingStandards);
  const produced = sum((r) => r.produced);
  const goodAll = rows.reduce((n, r) => n + (r.quality !== null && r.produced > 0 ? (r.quality / 100) * r.produced : 0), 0);
  const idealAll = rows.reduce((n, r) => (r.performance !== null ? n + (r.performance / 100) * r.runMinutes : n), 0);
  const total = calcOee({ plannedMinutes: sum((r) => r.plannedMinutes), downtimeMinutes: sum((r) => r.downtimeMinutes), idealMinutes: missingAll > 0 || produced <= 0 ? null : idealAll, good: goodAll, scrap: produced - goodAll, rework: 0 });
  return { from: fromStr, to: toStr, workingDays: days, dailyShiftMinutes, machines: rows, total: { ...total, missingStandards: missingAll, stoppages: sum((r) => r.stoppages) } };
}
