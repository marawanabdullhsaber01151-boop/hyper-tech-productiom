import { createHash } from "node:crypto";
import {
  addDecimalQuantities,
  compareDecimalQuantities,
  divideDecimalQuantities,
  isPositiveDecimalQuantity,
  maxZeroDecimalQuantity,
  multiplyDecimalQuantities,
  subtractDecimalQuantities,
} from "../lib/decimal-quantity";

export type PlanningDemandInput = {
  grossQty: string;
  availableQty: string;
  reservedQty: string;
  quarantineQty: string;
  openSupplyQty: string;
  leadDays: number;
  requiredBy: string;
};

export type PlanningRequirementResult = {
  freeAvailableQty: string;
  netQty: string;
  status: "covered" | "shortage";
  shortageCode: "none" | "reserved_or_quarantined" | "open_supply_late" | "purchase_required";
  explanation: string;
};

export function calculatePlanningRequirement(input: PlanningDemandInput): PlanningRequirementResult {
  const freeAvailableQty = maxZeroDecimalQuantity(
    subtractDecimalQuantities(input.availableQty, addDecimalQuantities(input.reservedQty, input.quarantineQty)),
  );
  const afterStock = maxZeroDecimalQuantity(subtractDecimalQuantities(input.grossQty, freeAvailableQty));
  const netQty = maxZeroDecimalQuantity(subtractDecimalQuantities(afterStock, input.openSupplyQty));
  const hasConstrainedStock = compareDecimalQuantities(input.reservedQty, "0") > 0
    || compareDecimalQuantities(input.quarantineQty, "0") > 0;
  const hasOpenSupply = compareDecimalQuantities(input.openSupplyQty, "0") > 0;

  if (compareDecimalQuantities(netQty, "0") === 0) {
    return {
      freeAvailableQty,
      netQty,
      status: "covered",
      shortageCode: hasConstrainedStock ? "reserved_or_quarantined" : "none",
      explanation: hasOpenSupply
        ? "المتاح الحر مع التوريد المفتوح يغطي الاحتياج."
        : "المتاح الحر يغطي الاحتياج.",
    };
  }

  const shortageCode = hasOpenSupply ? "open_supply_late"
    : hasConstrainedStock ? "reserved_or_quarantined"
    : "purchase_required";
  return {
    freeAvailableQty,
    netQty,
    status: "shortage",
    shortageCode,
    explanation: hasOpenSupply
      ? `يوجد عجز ${netQty} بعد احتساب التوريد المفتوح؛ راجع موعد التوريد قبل تاريخ الاحتياج ${input.requiredBy}.`
      : `يوجد عجز ${netQty} ويحتاج إلى شراء أو بديل معتمد قبل تاريخ الاحتياج ${input.requiredBy}.`,
  };
}

export function buildPlanningRunKey(input: unknown): string {
  const canonical = JSON.stringify(input, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = value[key];
        return sorted;
      }, {});
    }
    return value;
  });
  return `RUN-${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
}

export function evaluateCapacity(requiredMinutes: number, availableMinutes: number) {
  const overloadMinutes = Math.max(0, requiredMinutes - availableMinutes);
  return {
    overloadMinutes,
    status: overloadMinutes > 0 ? "overloaded" as const : "within_capacity" as const,
    explanation: overloadMinutes > 0
      ? `الحمل يتجاوز الطاقة المتاحة بمقدار ${overloadMinutes} دقيقة؛ جرّب تغيير المركز أو تقسيم الدفعة.`
      : "الحمل داخل الطاقة المتاحة.",
  };
}

export type CapacityLoadInput = {
  workCenterId?: number | null;
  machineId?: number | null;
  shiftId?: number | null;
  loadDate: string;
  requiredMinutes: number;
  availableMinutes: number;
};

/**
 * Two demand lines can target the same center/date/shift. Merge them before
 * evaluating capacity so the cockpit cannot hide an overload by displaying
 * each line independently.
 */
export function mergeCapacityLoads(loads: CapacityLoadInput[]) {
  const merged = new Map<string, CapacityLoadInput>();
  for (const load of loads) {
    const key = [
      load.workCenterId ?? "", load.machineId ?? "", load.shiftId ?? "", load.loadDate,
    ].join(":");
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...load });
      continue;
    }
    current.requiredMinutes += load.requiredMinutes;
    current.availableMinutes = Math.max(current.availableMinutes, load.availableMinutes);
  }
  return [...merged.values()];
}

export function buildReleaseImpact(input: {
  shortageCount: number;
  overloadedCount: number;
  requirementCount: number;
}) {
  return {
    requirementCount: input.requirementCount,
    shortageCount: input.shortageCount,
    overloadedCount: input.overloadedCount,
    liveReservationsChanged: false,
    liveOrdersChanged: false,
    warning: input.shortageCount || input.overloadedCount
      ? "الخطة تحتوي استثناءات تحتاج قرارًا قبل تشغيلها."
      : "لا توجد استثناءات تخطيطية مسجلة.",
  };
}
/* ───────────── فرد الوصفات لاحتياجات خامات (خطوة 34) ───────────── */

export type ExplodeRecipe = {
  id: number;
  productName: string;
  productCode: string | null;
  outputQty: string;
  isActive: boolean;
  items: Array<{ id: number; inventoryItemId: number | null; materialName: string; qty: string; unit: string }>;
};
export type ExplodeLine = { bomRecipeId: number; qty: string; requiredBy: string };
export type DemandSource = { recipeId: number; productName: string; lineNo: number; producedQty: string; perBatchQty: string; outputQty: string; contribution: string };
export type ExplodedDemand = {
  inventoryItemId: number;
  materialName: string;
  unit: string;
  grossQty: string;
  requiredBy: string;
  sources: DemandSource[];
};
export type ExplodeBlockerCode = "recipe_missing" | "recipe_inactive" | "recipe_empty" | "item_unlinked" | "bad_output_qty";
export type ExplodeBlocker = { code: ExplodeBlockerCode; recipeId: number; productName: string | null; materialName: string | null; message: string };

/** تقريب لأعلى لـ3 خانات عشرية (الشراء الناقص أخطر من الزايد: ما نطلبش أقل من اللازم). */
export function ceilDecimalToThree(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const f = fraction.padEnd(6, "0");
  let n = BigInt(`${whole}${f.slice(0, 3)}`);
  if (/[1-9]/.test(f.slice(3))) n += 1n;
  const text = n.toString().padStart(4, "0");
  const w = text.slice(0, -3);
  const frac = text.slice(-3).replace(/0+$/, "");
  return frac ? `${w}.${frac}` : w;
}

/**
 * الاحتياج لكل خامة = كمية الخامة للدفعة × الكمية المطلوب إنتاجها ÷ ناتج الدفعة.
 * نفس الخامة في أكتر من سطر/وصفة بتتجمّع (مع حفظ مصدر كل جزء للتتبّع)، وأبكر تاريخ احتياج هو اللي بيتاخد.
 * أي مكوّن مش مربوط بالمخزون أو وصفة موقوفة/فاضية بتتحوّل لـ blocker ومش بتتخمّن.
 */
export function explodeBomLines(lines: ExplodeLine[], recipes: ExplodeRecipe[]): { demands: ExplodedDemand[]; blockers: ExplodeBlocker[] } {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const acc = new Map<number, { demand: Omit<ExplodedDemand, "grossQty">; total: string }>();
  const blockers: ExplodeBlocker[] = [];
  const seenBlockers = new Set<string>();
  const block = (b: ExplodeBlocker) => {
    const key = `${b.code}:${b.recipeId}:${b.materialName ?? ""}`;
    if (!seenBlockers.has(key)) { seenBlockers.add(key); blockers.push(b); }
  };

  lines.forEach((line, index) => {
    const recipe = byId.get(line.bomRecipeId);
    if (!recipe) {
      block({ code: "recipe_missing", recipeId: line.bomRecipeId, productName: null, materialName: null, message: "الوصفة مش موجودة." });
      return;
    }
    if (!recipe.isActive) {
      block({ code: "recipe_inactive", recipeId: recipe.id, productName: recipe.productName, materialName: null, message: `وصفة ${recipe.productName} موقوفة. فعّلها أو اختار وصفة تانية.` });
      return;
    }
    if (!isPositiveDecimalQuantity(recipe.outputQty)) {
      block({ code: "bad_output_qty", recipeId: recipe.id, productName: recipe.productName, materialName: null, message: `ناتج الدفعة في وصفة ${recipe.productName} لازم يبقى أكبر من صفر.` });
      return;
    }
    if (!recipe.items.length) {
      block({ code: "recipe_empty", recipeId: recipe.id, productName: recipe.productName, materialName: null, message: `وصفة ${recipe.productName} من غير مكوّنات.` });
      return;
    }
    for (const item of recipe.items) {
      if (item.inventoryItemId == null) {
        block({ code: "item_unlinked", recipeId: recipe.id, productName: recipe.productName, materialName: item.materialName, message: `المكوّن «${item.materialName}» في وصفة ${recipe.productName} مش مربوط بصنف في المخزون. اربطه الأول عشان الاحتياج يتحسب صح.` });
        continue;
      }
      const contribution = divideDecimalQuantities(multiplyDecimalQuantities(item.qty, line.qty), recipe.outputQty);
      const entry = acc.get(item.inventoryItemId) ?? {
        demand: { inventoryItemId: item.inventoryItemId, materialName: item.materialName, unit: item.unit, requiredBy: line.requiredBy, sources: [] },
        total: "0",
      };
      entry.total = addDecimalQuantities(entry.total, contribution);
      if (line.requiredBy < entry.demand.requiredBy) entry.demand.requiredBy = line.requiredBy;
      entry.demand.sources.push({ recipeId: recipe.id, productName: recipe.productName, lineNo: index + 1, producedQty: line.qty, perBatchQty: item.qty, outputQty: recipe.outputQty, contribution });
      acc.set(item.inventoryItemId, entry);
    }
  });

  const demands = [...acc.values()]
    .map(({ demand, total }) => ({ ...demand, grossQty: ceilDecimalToThree(total) }))
    .filter((d) => compareDecimalQuantities(d.grossQty, "0") > 0)
    .sort((a, b) => a.inventoryItemId - b.inventoryItemId);
  return { demands, blockers };
}
