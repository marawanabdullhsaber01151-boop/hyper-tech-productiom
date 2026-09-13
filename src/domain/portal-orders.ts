/** @format */

export type PortalOrderItem = {
  id: number;
  orderNumber: string;
  productName: string;
  qty: string;
  unit: string;
  workflowStatus: string;
};

export function toPortalOrderItem(
  order: PortalOrderItem,
): PortalOrderItem {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    productName: order.productName,
    qty: order.qty,
    unit: order.unit,
    workflowStatus: order.workflowStatus,
  };
}