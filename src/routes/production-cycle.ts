/** @format */

import { Router, Request, Response, NextFunction } from "express";
import { desc } from "drizzle-orm";
import { db } from "../db";
import { productionWorkflowOrdersTable } from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getCycleStage,
  PRODUCTION_CYCLE_STAGES,
} from "../domain/production-cycle";

const router = Router();
const productionRoles = [
  "chairman",
  "production_manager",
  "warehouse_manager",
  "supervisor",
  "production_quality_controller",
];

router.get(
  "/production-cycle/stages",
  requireAuth,
  requireRole(...productionRoles),
  (_req: Request, res: Response) => {
    res.json({ data: PRODUCTION_CYCLE_STAGES });
  },
);

router.get(
  "/production-cycle/dashboard",
  requireAuth,
  requireRole(...productionRoles),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const orders = await db
        .select()
        .from(productionWorkflowOrdersTable)
        .orderBy(desc(productionWorkflowOrdersTable.createdAt));

      const activeOrders = orders.filter(
        (order) => order.workflowStatus !== "cancelled",
      );
      const stages = PRODUCTION_CYCLE_STAGES.map((stage) => {
        const stageOrders = activeOrders.filter(
          (order) =>
            getCycleStage(order.workflowStatus, order.currentStage).key ===
            stage.key,
        );
        return {
          ...stage,
          orderCount: stageOrders.length,
          orders: stageOrders.slice(0, 8).map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber,
            productName: order.productName,
            workflowStatus: order.workflowStatus,
            neededBy: order.neededBy,
            currentStage: order.currentStage,
          })),
        };
      });

      res.json({
        data: {
          stages,
          totals: {
            activeOrders: activeOrders.length,
            completedOrders: orders.filter((o) =>
              ["delivered_customer", "delivered_warehouse"].includes(
                o.workflowStatus,
              ),
            ).length,
            blockedOrders: orders.filter((o) =>
              ["materials_rejected", "quality_check"].includes(
                o.workflowStatus,
              ),
            ).length,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
