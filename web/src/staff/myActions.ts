import type { WorkflowOrder } from "./dashboardCore";

/** «مطلوب مني دلوقتي»: أوامر الإنتاج اللي مستنية خطوة من دور المستخدم (نفس منطق اللوحة القديمة، بس متغطّي باختبارات). */
export type ActionKind = "confirmCustomerDelivery" | "receiveAndDistribute" | "decideMaterials" | "confirmWarehouseReceipt" | "advanceStage" | "qualityCheck" | "stuck";
export interface MyAction {
  order: WorkflowOrder;
  kind: ActionKind;
}

/** الأدوار اللي ليها قايمة «مطلوب مني». أي دور تاني مابنحمّلش له الأوامر أصلًا (توفير طلبات). */
export const ACTION_ROLES = ["hr", "production_manager", "warehouse_manager", "supervisor", "production_quality_controller", "chairman", "executive_manager"] as const;
export const hasActionList = (role: string) => (ACTION_ROLES as readonly string[]).includes(role);

export function computeMyActions(orders: WorkflowOrder[], me: { id: number; role: string }): MyAction[] {
  const pick = (f: (o: WorkflowOrder) => boolean, kind: ActionKind | ((o: WorkflowOrder) => ActionKind)): MyAction[] =>
    orders.filter(f).map((order) => ({ order, kind: typeof kind === "function" ? kind(order) : kind }));
  switch (me.role) {
    case "hr":
      return pick((o) => o.workflowStatus === "delivery_pending_customer", "confirmCustomerDelivery");
    case "production_manager":
      return pick((o) => o.workflowStatus === "new", "receiveAndDistribute");
    case "warehouse_manager":
      return pick(
        (o) => o.workflowStatus === "materials_requested" || o.workflowStatus === "delivery_pending_warehouse",
        (o) => (o.workflowStatus === "materials_requested" ? "decideMaterials" : "confirmWarehouseReceipt"),
      );
    case "supervisor":
      return pick((o) => o.workflowStatus === "in_production" && o.supervisorId === me.id, "advanceStage");
    case "production_quality_controller":
      return pick((o) => o.workflowStatus === "quality_check" && o.qualityControllerUserId === me.id, "qualityCheck");
    case "chairman":
    case "executive_manager":
      return pick((o) => ["new", "materials_requested", "delivery_pending_customer", "delivery_pending_warehouse"].includes(o.workflowStatus), "stuck");
    default:
      return [];
  }
}
