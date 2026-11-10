/** @format */
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "../db";
import { foundationShiftsTable, foundationWorkCentersTable, productionWorkflowOrdersTable } from "../db/schema";
import { loadCapacityConfig, type CapacityConfig } from "./capacityConfig";
import { buildCenterSchedule, centerDailyMinutes, parseRouting, type CenterInput, type CenterSchedule, type OrderInput } from "./capacityCentersCore";
import { todayCairo } from "./operationsCapacityCore";
import { loadRecipeRoutings } from "./routingResolve";

const DONE = ["completed", "delivered_customer", "delivered_warehouse", "cancelled", "closed", "corrected"];

export interface CenterInputs {
  orders: OrderInput[];
  centers: CenterInput[];
  config: CapacityConfig;
  activeShifts: number;
  /** أوامر مسارها اتحسب من مسار المنتج الحالي لأنه مش محفوظ عليها */
  liveRoutingOrders: number;
}

/**
 * مدخلات الجدولة: الأوامر المفتوحة بمسارها المحفوظ، ولو الأمر مالوش مسار محفوظ (أوامر بتتعمل من غير لقطة مسار)
 * بنستخدم مسار المنتج المعتمد الحالي (وصفة ← صنف أساسي ← منتج هندسي ← نسخة سارية). مفيش كتابة.
 */
export async function loadCenterInputs(now: Date): Promise<CenterInputs> {
  const today = todayCairo(now);
  const [orders, centers, shifts, config] = await Promise.all([
    db
      .select({
        id: productionWorkflowOrdersTable.id,
        orderNumber: productionWorkflowOrdersTable.orderNumber,
        productName: productionWorkflowOrdersTable.productName,
        neededBy: productionWorkflowOrdersTable.neededBy,
        qty: productionWorkflowOrdersTable.qty,
        status: productionWorkflowOrdersTable.workflowStatus,
        routing: productionWorkflowOrdersTable.routingSnapshot,
        recipeId: productionWorkflowOrdersTable.bomRecipeId,
      })
      .from(productionWorkflowOrdersTable)
      .where(notInArray(productionWorkflowOrdersTable.workflowStatus, DONE)),
    db.select().from(foundationWorkCentersTable).where(eq(foundationWorkCentersTable.active, true)),
    db.select({ id: foundationShiftsTable.id }).from(foundationShiftsTable).where(and(eq(foundationShiftsTable.active, true))),
    loadCapacityConfig(now),
  ]);
  const needLive = orders.filter((o) => parseRouting(o.routing).length === 0 && o.recipeId !== null).map((o) => o.recipeId as number);
  const live = await loadRecipeRoutings(needLive, today);
  let liveCount = 0;
  const inputs = orders.map((o): OrderInput => {
    let routing: unknown = o.routing;
    if (parseRouting(routing).length === 0 && o.recipeId !== null && live.has(o.recipeId)) {
      routing = live.get(o.recipeId);
      liveCount += 1;
    }
    return { id: o.id, orderNumber: o.orderNumber, productName: o.productName, neededBy: o.neededBy, qty: Number(o.qty), status: o.status, routing };
  });
  return {
    orders: inputs,
    centers: centers.map((c) => ({ id: c.id, code: c.code, name: c.name, dailyMinutes: centerDailyMinutes(c.capacityMinutesPerShift, shifts.length) })),
    config,
    activeShifts: shifts.length,
    liveRoutingOrders: liveCount,
  };
}

export interface CenterCapacitySnapshot extends CenterSchedule {
  activeShifts: number;
  shiftsAssumed: boolean;
  liveRoutingOrders: number;
  config: CapacityConfig;
}

/** خريطة السعة بمراكز العمل: الأوامر المفتوحة على مراكز العمل النشطة، وسعتها من الورديات النشطة والإعدادات. */
export async function loadCenterCapacity(now: Date): Promise<CenterCapacitySnapshot> {
  const inp = await loadCenterInputs(now);
  const schedule = buildCenterSchedule({ orders: inp.orders, centers: inp.centers, startIso: todayCairo(now), cap: inp.config.cap, calendar: inp.config.calendar });
  return { ...schedule, activeShifts: inp.activeShifts, shiftsAssumed: inp.activeShifts === 0, liveRoutingOrders: inp.liveRoutingOrders, config: inp.config };
}
