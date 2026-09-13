/**
 * Operations Control policy boundary.
 *
 * Stage 01 is intentionally planning-only. Dispatch remains a separate,
 * approval-gated capability and is not granted to operations_manager by
 * default.
 */

export const OPERATIONS_CONTROL_ACTIONS = {
  caseView: "operations.case.view",
  analysisRun: "operations.analysis.run",
  planCreate: "operations.plan.create",
  planEdit: "operations.plan.edit",
  planSubmit: "operations.plan.submit",
  planApprove: "operations.plan.approve",
  planDispatch: "operations.plan.dispatch",
} as const;

export const OPERATIONS_CONTROL_ROLES = {
  caseView: ["operations_manager", "executive_manager", "chairman"] as const,
  analysisRun: ["operations_manager", "executive_manager", "chairman"] as const,
  planCreate: ["operations_manager", "executive_manager", "chairman"] as const,
  planEdit: ["operations_manager", "executive_manager", "chairman"] as const,
  planSubmit: ["operations_manager", "executive_manager", "chairman"] as const,
  planApprove: ["executive_manager", "chairman"] as const,
  // Dispatch is deliberately not granted to operations_manager in Stage 01.
  planDispatch: ["executive_manager", "chairman"] as const,
} as const;

/**
 * Missing or malformed configuration fails closed.
 * Only an explicit "false" can turn off the planning-only boundary.
 */
export function isPlanningOnlyEnabled(value: string | null | undefined): boolean {
  return value !== "false";
}

/**
 * This is the future dispatch gate. Stage 01 never supplies an approved plan,
 * so the deprecated execute endpoint cannot pass this check.
 */
export function canDispatchPlan(input: {
  role: string;
  planningOnly: boolean;
  planApproved: boolean;
}): boolean {
  return (
    !input.planningOnly &&
    input.planApproved &&
    (OPERATIONS_CONTROL_ROLES.planDispatch as readonly string[]).includes(input.role)
  );
}

export const PLANNING_BOUNDARY_SETTING = "operations_control.planning_only";