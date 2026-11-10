/** @format */
// حساب وعد التسليم لحالة تشغيل (44): محاكاة بمسار التصنيع لو متاح، وإلا بمدة الوصفة. قراية فقط، بيتشارك بين العرض والتثبيت.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { bomRecipesTable, operationsCaseLinesTable, operationsCasesTable } from "../db/schema";
import { loadCenterInputs } from "./capacityCenters";
import { loadCapacityForecast } from "./operationsCapacity";
import { deliveryPromise, orderDemandDays, todayCairo } from "./operationsCapacityCore";
import { planConversion } from "./operationsCenterCore";
import { seedOf, simulatePromise } from "./promiseSimCore";
import { loadRecipeRoutings } from "./routingResolve";

export interface CasePromiseBody {
  earliest: string;
  likely: string;
  latest: string;
  verdict: "ok" | "tight" | "late" | "none";
  method: "simulation" | "days";
  /** تاريخ الوعد: بنسبة الثقة في المحاكاة، أو الأبعد في الحساب بمدة الوصفة */
  confidenceDate: string;
  confidence: number | null;
  runs: number;
  neededDays: number;
  dueDate: string | null;
  queueDays: number;
  lines: number;
  linesAssumed: boolean;
  assumedDurationLines: number;
  utilization: number;
}

export async function computeCasePromise(id: number, now: Date): Promise<{ status: string; body: CasePromiseBody } | null> {
  const [record] = await db.select().from(operationsCasesTable).where(eq(operationsCasesTable.id, id)).limit(1);
  if (!record) return null;
  const [lines, recipes] = await Promise.all([
    db.select().from(operationsCaseLinesTable).where(eq(operationsCaseLinesTable.caseId, id)),
    db.select({ id: bomRecipesTable.id, productName: bomRecipesTable.productName, outputQty: bomRecipesTable.outputQty, days: bomRecipesTable.expectedProductionDays }).from(bomRecipesTable),
  ]);
  const plan = planConversion(lines.map((l) => ({ id: l.id, productNameSnapshot: l.productNameSnapshot })), recipes);
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  const recipeOf = new Map(plan.resolved.map((r) => [r.lineId, recipeById.get(r.recipeId)]));
  let needed = 0;
  for (const l of lines) {
    const r = recipeOf.get(l.id);
    needed += orderDemandDays({ expectedProductionDays: r?.days ?? null, qty: Number(l.orderedQty), outputQty: Number(r?.outputQty ?? 1), status: "claimed" });
  }
  const today = todayCairo(now);
  const cap = await loadCapacityForecast(now);
  const daysPromise = deliveryPromise({ queueDays: cap.forecast.queueDays, newDays: needed, lines: cap.lines, startIso: today, dueDate: record.dueDate, cap: cap.config.cap, calendar: cap.config.calendar });
  // لو كل سطور الحالة ليها وصفة بمسار تصنيع معتمد: الوعد بمحاكاة دقايق مراكز العمل (وإلا بمدة الوصفة زي الأول).
  const recipeOfLine = new Map(plan.resolved.map((r) => [r.lineId, r.recipeId]));
  const routings = await loadRecipeRoutings([...recipeOfLine.values()], today);
  const allRouted = lines.every((l) => recipeOfLine.has(l.id) && routings.has(recipeOfLine.get(l.id) as number));
  const inp = allRouted ? await loadCenterInputs(now) : null;
  const sim = inp
    ? simulatePromise({
        queue: inp.orders,
        centers: inp.centers,
        lines: lines.map((l) => ({ qty: Number(l.orderedQty), routing: routings.get(recipeOfLine.get(l.id) as number) })),
        dueDate: record.dueDate,
        startIso: today,
        cap: cap.config.cap,
        calendar: cap.config.calendar,
        variability: cap.config.variability,
        confidence: cap.config.confidence,
        seed: seedOf([id, today, inp.orders.length]),
      })
    : null;
  const promise = sim ? { earliest: sim.earliest, likely: sim.likely, latest: sim.latest, verdict: sim.verdict } : daysPromise;
  return {
    status: record.status,
    body: {
      ...promise,
      method: sim ? "simulation" : "days",
      confidenceDate: sim?.confidenceDate ?? daysPromise.latest,
      confidence: sim?.confidence ?? null,
      runs: sim?.runs ?? 0,
      neededDays: daysPromise.neededDays,
      dueDate: record.dueDate,
      queueDays: cap.forecast.queueDays,
      lines: cap.lines,
      linesAssumed: cap.linesAssumed,
      assumedDurationLines: plan.unresolved.length,
      utilization: cap.forecast.utilization,
    },
  };
}
