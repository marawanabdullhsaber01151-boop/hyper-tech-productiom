/** @format */
/**
 * Phase 04 (delivery 1) — engineering product-version governance. Pure
 * logic only; DB-aware orchestration lives in ../lib/engineering-governance.ts.
 */

export const ENGINEERING_VERSION_TRANSITIONS: Record<
  string,
  readonly string[]
> = {
  draft: ["in_review"],
  in_review: ["draft", "approved"],
  approved: ["in_review", "released"],
  released: ["superseded", "retired"],
  superseded: ["retired"],
  retired: [],
};

export function isAllowedEngineeringVersionTransition(
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  return (ENGINEERING_VERSION_TRANSITIONS[from] ?? []).includes(to);
}

export function assertAllowedEngineeringVersionTransition(
  from: string,
  to: string,
): void {
  if (isAllowedEngineeringVersionTransition(from, to)) return;
  throw Object.assign(
    new Error(`لا يمكن تغيير حالة الإصدار الهندسي من "${from}" إلى "${to}"`),
    { status: 409, code: "INVALID_STATUS_TRANSITION" },
  );
}

/**
 * "Make the released version obvious and prevent editing it in place."
 * Anything other than draft/in_review is frozen: components, routing
 * operations, and the version's own descriptive fields cannot change —
 * the only way forward is a new version.
 */
export function isEngineeringVersionEditable(status: string): boolean {
  return status === "draft" || status === "in_review";
}

export function assertEngineeringVersionEditable(status: string): void {
  if (isEngineeringVersionEditable(status)) return;
  throw Object.assign(
    new Error(
      `الإصدار في حالة "${status}" ولا يمكن تعديله — أنشئ إصدارًا جديدًا بدلًا من ذلك`,
    ),
    { status: 409, code: "VERSION_NOT_EDITABLE" },
  );
}

export type BomComponentInput = {
  componentType: string;
  foundationItemId?: number | null;
  subAssemblyProductId?: number | null;
  qty: number;
  unit: string;
  scrapFactorPct?: number;
};

export type ManufacturabilityIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  context?: Record<string, unknown>;
};

/** One component's own shape, independent of anything else in the BOM. */
export function validateBomComponentShape(
  component: BomComponentInput,
  lineNo: number,
): ManufacturabilityIssue[] {
  const issues: ManufacturabilityIssue[] = [];
  const hasFoundationItem = component.foundationItemId != null;
  const hasSubAssembly = component.subAssemblyProductId != null;
  if (hasFoundationItem === hasSubAssembly) {
    issues.push({
      severity: "error",
      code: "COMPONENT_SOURCE_AMBIGUOUS",
      message: `السطر ${lineNo}: يجب تحديد صنف أساسي أو منتج فرعي واحد فقط لهذا المكوّن`,
      context: { lineNo },
    });
  }
  if (!(component.qty > 0)) {
    issues.push({
      severity: "error",
      code: "IMPOSSIBLE_QUANTITY",
      message: `السطر ${lineNo}: الكمية يجب أن تكون أكبر من صفر`,
      context: { lineNo, qty: component.qty },
    });
  }
  if (!component.unit || component.unit.trim().length === 0) {
    issues.push({
      severity: "error",
      code: "MISSING_UNIT",
      message: `السطر ${lineNo}: وحدة القياس مطلوبة`,
      context: { lineNo },
    });
  }
  const scrap = component.scrapFactorPct ?? 0;
  if (scrap < 0 || scrap >= 100) {
    issues.push({
      severity: "error",
      code: "INVALID_SCRAP_FACTOR",
      message: `السطر ${lineNo}: نسبة الهالك يجب أن تكون بين 0 و100`,
      context: { lineNo, scrapFactorPct: scrap },
    });
  }
  return issues;
}

export type RoutingStepInput = {
  operationNo: number;
  workCenterId?: number | null;
  setupMinutes: number;
  runMinutesPerUnit: number;
  workersRequired: number;
};

export function validateRoutingStepShape(
  step: RoutingStepInput,
): ManufacturabilityIssue[] {
  const issues: ManufacturabilityIssue[] = [];
  if (!step.workCenterId) {
    issues.push({
      severity: "error",
      code: "MISSING_WORK_CENTER",
      message: `العملية رقم ${step.operationNo}: لا يوجد مركز عمل محدد`,
      context: { operationNo: step.operationNo },
    });
  }
  if (step.setupMinutes < 0 || step.runMinutesPerUnit < 0) {
    issues.push({
      severity: "error",
      code: "NEGATIVE_TIME",
      message: `العملية رقم ${step.operationNo}: زمن التجهيز/التشغيل لا يمكن أن يكون سالبًا`,
      context: { operationNo: step.operationNo },
    });
  }
  if (step.workersRequired < 1) {
    issues.push({
      severity: "error",
      code: "INVALID_WORKER_COUNT",
      message: `العملية رقم ${step.operationNo}: عدد العمال المطلوب يجب أن يكون 1 على الأقل`,
      context: { operationNo: step.operationNo },
    });
  }
  return issues;
}

export function findDuplicateOperationNumbers(
  steps: RoutingStepInput[],
): number[] {
  const seen = new Set<number>();
  const dupes = new Set<number>();
  for (const step of steps) {
    if (seen.has(step.operationNo)) dupes.add(step.operationNo);
    seen.add(step.operationNo);
  }
  return [...dupes].sort((a, b) => a - b);
}

/**
 * A sub-assembly edge: this engineering product's BOM consumes that
 * engineering product as a component. Detects a cycle reachable from
 * `startProductId` using DFS with an explicit recursion stack (so it
 * reports the actual cycle path, not just "yes/no"), which a
 * visited-only search cannot do.
 */
export function detectBomCycle(
  edges: ReadonlyArray<{ from: number; to: number }>,
  startProductId: number,
): number[] | null {
  const adjacency = new Map<number, number[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }
  const visited = new Set<number>();
  const stack: number[] = [];
  const onStack = new Set<number>();

  function dfs(node: number): number[] | null {
    visited.add(node);
    onStack.add(node);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      if (onStack.has(next)) {
        const cycleStart = stack.indexOf(next);
        return stack.slice(cycleStart).concat(next);
      }
      if (!visited.has(next)) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    stack.pop();
    onStack.delete(node);
    return null;
  }

  return dfs(startProductId);
}

export function summarizeManufacturabilityIssues(
  issues: ManufacturabilityIssue[],
): { passed: boolean; errorCount: number; warningCount: number } {
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  return { passed: errorCount === 0, errorCount, warningCount };
}
