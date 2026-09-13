export const FIELD_VISIBILITY: Record<string, Record<string, readonly string[]>> = {
  inventory_items: {
    unitPrice: ["chairman", "executive_manager", "hr", "hr_manager", "warehouse_manager", "storekeeper"],
    supplierId: ["chairman", "executive_manager", "hr", "hr_manager", "purchasing_manager", "buyer", "warehouse_manager"],
  },
  sales_order_items: {
    unitPrice: ["chairman", "executive_manager", "sales_manager", "hr", "hr_manager"],
  },
};

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