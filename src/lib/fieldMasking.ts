export const FIELD_VISIBILITY: Record<string, Record<string, readonly string[]>> = {
  inventory_items: {
    unitPrice: ["chairman", "executive_manager", "hr", "hr_manager", "warehouse_manager", "storekeeper"],
    supplierId: ["chairman", "executive_manager", "hr", "hr_manager", "purchasing_manager", "buyer", "warehouse_manager"],
  },
  sales_order_items: {
    unitPrice: ["chairman", "executive_manager", "sales_manager", "hr", "hr_manager"],
  },
};

export const FACTORY_FLOOR_ROLES = new Set([
  "production_manager",
  "supervisor",
  "production_controller",
  "production_quality_controller",
]);

export const PRODUCTION_CUSTOMER_PII_FIELDS = [
  "customerName",
  "customerPhone",
  "customerEmail",
  "customerAddress",
  "portalCustomerId",
  "salesOrderId",
  "salesOrderRef",
  "rootSalesOrderId",
  "parentWorkflowOrderId",
  "createdById",
  "createdByName",
] as const;

/**
 * Serialization boundary for production workflow responses. The frontend
 * cannot opt out of this: the route removes the fields before res.json().
 */
export function maskProductionWorkflowPayload<T>(payload: T, userRole: string): T {
  if (!FACTORY_FLOOR_ROLES.has(userRole)) return payload;

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    if (value instanceof Date) return value;
    const result: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const field of PRODUCTION_CUSTOMER_PII_FIELDS) delete result[field];
    for (const [key, child] of Object.entries(result)) result[key] = visit(child);
    return result;
  };

  return visit(payload) as T;
}

export function maskFields<T extends object>(
  resourceType: string,
  rows: T | T[],
  userRole: string,
): T | T[] {
  const fields = FIELD_VISIBILITY[resourceType] ?? {};
  const mask = (row: T): T => {
    const result = { ...row } as Record<string, unknown>;
    for (const [field, roles] of Object.entries(fields)) {
      if (!roles.includes(userRole)) delete result[field];
    }
    return result as T;
  };
  return Array.isArray(rows) ? rows.map(mask) : mask(rows);
}