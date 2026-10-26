/** قواعد التحويلات في الواجهة (نفس TRANSFER_CREATORS / TRANSFER_RECEIVERS في السيرفر). */
export const TRANSFER_DIRECTIONS = [
  "warehouse_to_operations",
  "operations_to_production",
  "production_to_operations",
  "operations_to_warehouse",
] as const;
export type TransferDirection = (typeof TRANSFER_DIRECTIONS)[number];

const OPS = ["operations_manager", "executive_manager", "chairman"];

export const TRANSFER_CREATORS: Record<TransferDirection, readonly string[]> = {
  warehouse_to_operations: ["warehouse_manager", ...OPS],
  operations_to_production: OPS,
  production_to_operations: ["production_manager", "supervisor", ...OPS],
  operations_to_warehouse: OPS,
};
export const TRANSFER_RECEIVERS: Record<TransferDirection, readonly string[]> = {
  warehouse_to_operations: OPS,
  operations_to_production: ["production_manager", "supervisor"],
  production_to_operations: OPS,
  operations_to_warehouse: ["warehouse_manager"],
};

export const isDirection = (d: string): d is TransferDirection => (TRANSFER_DIRECTIONS as readonly string[]).includes(d);
export const creatableDirections = (role: string) => TRANSFER_DIRECTIONS.filter((d) => TRANSFER_CREATORS[d].includes(role));
export const canReceiveTransfer = (role: string, direction: string) => isDirection(direction) && TRANSFER_RECEIVERS[direction].includes(role);

/** هل الحركة بتغيّر رصيد المخزن لما تتستلم؟ (مرة واحدة بس عند الخروج من المخزن، ومرة عند الرجوع). */
export function stockNote(direction: string): "out" | "in" | "none" {
  if (direction === "warehouse_to_operations") return "out";
  if (direction === "operations_to_warehouse") return "in";
  return "none";
}

export const QUANTITY_RE = /^\d+(\.\d{1,3})?$/;

export function newIdempotencyKey(): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `tr-${rnd}`;
}
