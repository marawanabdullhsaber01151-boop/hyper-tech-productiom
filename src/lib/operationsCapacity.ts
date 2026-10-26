import { and, eq, notInArray } from "drizzle-orm";
import { db } from "../db";
import { bomRecipesTable, foundationWorkCentersTable, productionWorkflowOrdersTable } from "../db/schema";
import { buildForecast, orderDemandDays, todayCairo, type Forecast } from "./operationsCapacityCore";

const DONE = ["completed", "delivered_customer", "delivered_warehouse", "cancelled", "closed", "corrected"];

export interface CapacitySnapshot {
  forecast: Forecast;
  lines: number;
  linesAssumed: boolean;
  openOrders: number;
  noRecipeOrders: number;
}

/** الحمل الحالي: الأوامر المفتوحة (غير المنتهية) بمدد وصفاتها، على عدد خطوط الإنتاج النشطة (لو مفيش خطوط معرّفة بنفترض خط واحد). */
export async function loadCapacityForecast(now: Date): Promise<CapacitySnapshot> {
  const [orders, centers] = await Promise.all([
    db
      .select({
        qty: productionWorkflowOrdersTable.qty,
        status: productionWorkflowOrdersTable.workflowStatus,
        neededBy: productionWorkflowOrdersTable.neededBy,
        recipeId: productionWorkflowOrdersTable.bomRecipeId,
        days: bomRecipesTable.expectedProductionDays,
        outputQty: bomRecipesTable.outputQty,
      })
      .from(productionWorkflowOrdersTable)
      .leftJoin(bomRecipesTable, eq(bomRecipesTable.id, productionWorkflowOrdersTable.bomRecipeId))
      .where(notInArray(productionWorkflowOrdersTable.workflowStatus, DONE)),
    db
      .select({ id: foundationWorkCentersTable.id })
      .from(foundationWorkCentersTable)
      .where(and(eq(foundationWorkCentersTable.active, true), eq(foundationWorkCentersTable.centerType, "production_line"))),
  ]);
  const lines = Math.max(1, centers.length);
  const demands = orders.map((o) => ({
    days: orderDemandDays({ expectedProductionDays: o.days ?? null, qty: Number(o.qty), outputQty: Number(o.outputQty ?? 1), status: o.status }),
    neededBy: o.neededBy,
  }));
  return {
    forecast: buildForecast({ demands, lines, startIso: todayCairo(now) }),
    lines,
    linesAssumed: centers.length === 0,
    openOrders: orders.length,
    noRecipeOrders: orders.filter((o) => o.recipeId === null).length,
  };
}
