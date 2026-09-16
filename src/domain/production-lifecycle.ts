import { createHash } from "node:crypto";

export const CANONICAL_PRODUCTION_STATUSES = [
  "new",
  "awaiting_operations_claim",
  "claimed",
  "pending_supervisor",
  "materials_requested",
  "materials_approved",
  "materials_partial",
  "materials_rejected",
  "in_production",
  "held",
  "rework",
  "quality_check",
  "partially_completed",
  "completed",
  "delivery_pending_customer",
  "delivery_pending_warehouse",
  "delivered_customer",
  "delivered_warehouse",
  "cancelled",
  "corrected",
  "closed",
] as const;

export type CanonicalProductionStatus =
  (typeof CANONICAL_PRODUCTION_STATUSES)[number];

export type ProductionSourceType =
  | "direct_workflow"
  | "production_request"
  | "operations_case"
  | "sales_order"
  | "legacy_production_order";

export type ProductionOrderSnapshot = {
  product: {
    name: string;
    bomRecipeId: number | null;
    bom: unknown;
    routing: unknown;
  };
  customerRequirement: unknown;
  quantity: {
    value: string;
    unit: string;
  };
  dueDate: string | null;
  priority: string;
};

export const CANONICAL_PRODUCTION_TRANSITIONS: Readonly<
  Record<CanonicalProductionStatus, readonly CanonicalProductionStatus[]>
> = {
  new: ["awaiting_operations_claim", "cancelled"],
  awaiting_operations_claim: ["claimed", "cancelled"],
  claimed: ["materials_requested", "cancelled"],
  pending_supervisor: ["materials_requested", "cancelled"],
  materials_requested: [
    "materials_approved",
    "materials_partial",
    "materials_rejected",
    "cancelled",
  ],
  materials_approved: ["in_production", "cancelled"],
  materials_partial: ["in_production", "cancelled"],
  materials_rejected: ["cancelled"],
  in_production: [
    "quality_check",
    "held",
    "rework",
    "partially_completed",
    "cancelled",
  ],
  held: ["in_production", "quality_check", "rework", "cancelled"],
  rework: ["in_production", "quality_check", "held", "cancelled"],
  quality_check: [
    "quality_check",
    "rework",
    "partially_completed",
    "completed",
    "held",
    "cancelled",
  ],
  partially_completed: [
    "in_production",
    "quality_check",
    "completed",
    "held",
    "cancelled",
  ],
  completed: [
    "delivery_pending_customer",
    "delivery_pending_warehouse",
    "corrected",
    "cancelled",
  ],
  delivery_pending_customer: ["delivered_customer", "cancelled"],
  delivery_pending_warehouse: ["delivered_warehouse", "cancelled"],
  delivered_customer: ["closed", "corrected"],
  delivered_warehouse: ["closed", "corrected"],
  corrected: ["quality_check", "in_production", "closed"],
  closed: [],
  cancelled: [],
};

export function isCanonicalProductionStatus(
  value: string,
): value is CanonicalProductionStatus {
  return (CANONICAL_PRODUCTION_STATUSES as readonly string[]).includes(value);
}

export function canTransitionCanonicalProduction(
  from: string,
  to: string,
): to is CanonicalProductionStatus {
  return (
    isCanonicalProductionStatus(from) &&
    isCanonicalProductionStatus(to) &&
    CANONICAL_PRODUCTION_TRANSITIONS[from].includes(to)
  );
}

export function assertCanonicalProductionTransition(
  from: string,
  to: string,
): void {
  if (!canTransitionCanonicalProduction(from, to)) {
    throw Object.assign(
      new Error(`انتقال دورة الإنتاج غير مسموح: ${from} → ${to}`),
      { status: 409, code: "INVALID_CANONICAL_PRODUCTION_TRANSITION" },
    );
  }
}

export function stableSnapshotJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableSnapshotJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSnapshotJson(record[key])}`)
    .join(",")}}`;
}

export function hashProductionSnapshot(snapshot: ProductionOrderSnapshot): string {
  return createHash("sha256")
    .update(stableSnapshotJson(snapshot))
    .digest("hex");
}

export function buildProductionOrderSnapshot(input: {
  productName: string;
  bomRecipeId: number | null;
  qty: string;
  unit: string;
  neededBy?: string | null;
  priority: string;
  customerRequirement?: unknown;
  bom?: unknown;
  routing?: unknown;
}): ProductionOrderSnapshot {
  return {
    product: {
      name: input.productName,
      bomRecipeId: input.bomRecipeId,
      bom: input.bom ?? null,
      routing: input.routing ?? null,
    },
    customerRequirement: input.customerRequirement ?? null,
    quantity: { value: input.qty, unit: input.unit },
    dueDate: input.neededBy ?? null,
    priority: input.priority,
  };
}

export function canonicalSourceKey(
  sourceType: ProductionSourceType,
  sourceId: number,
  sourceRevision = 1,
): string {
  return `${sourceType}:${sourceId}:r${sourceRevision}`;
}

export function requiredReasonForCanonicalTransition(
  from: string,
  to: string,
): boolean {
  return (
    to === "cancelled" ||
    to === "held" ||
    to === "rework" ||
    to === "corrected" ||
    from === "partially_completed"
  );
}

export type ConformanceOrder = {
  id: number;
  workflowStatus: string;
  lifecycleRevision: number;
  snapshotHash: string | null;
  canonicalSourceType: string | null;
  canonicalSourceId: number | null;
};

export function findProductionConformanceIssues(
  order: ConformanceOrder,
  eventRevisions: number[],
): string[] {
  const issues: string[] = [];
  if (!isCanonicalProductionStatus(order.workflowStatus)) {
    issues.push("UNKNOWN_STATUS");
  }
  if (!order.snapshotHash) issues.push("MISSING_SNAPSHOT_HASH");
  if (order.canonicalSourceType && !order.canonicalSourceId) {
    issues.push("SOURCE_ID_MISSING");
  }
  const sorted = [...eventRevisions].sort((a, b) => a - b);
  if (sorted.length && sorted[sorted.length - 1] !== order.lifecycleRevision) {
    issues.push("EVENT_REVISION_MISMATCH");
  }
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      issues.push("EVENT_REVISION_GAP");
      break;
    }
  }
  return issues;
}