import { createHash } from "node:crypto";
import {
  addDecimalQuantities,
  compareDecimalQuantities,
  maxZeroDecimalQuantity,
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