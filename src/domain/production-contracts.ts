import { z } from "zod";
import {
  PRODUCTION_STATUSES,
  type ProductionStatus,
} from "./production-status";

export const productionStatusSchema = z.enum(PRODUCTION_STATUSES);

export const productionOrderContractSchema = z.object({
  id: z.number(),
  orderNumber: z.string(),
  workflowStatus: productionStatusSchema,
  productName: z.string(),
  qty: z.string(),
  unit: z.string(),
  bomRecipeId: z.number().nullable(),
  salesOrderId: z.number().nullable(),
  createdById: z.number(),
  createdByName: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const productionTransitionContractSchema = z.object({
  orderId: z.number().int().positive(),
  from: productionStatusSchema,
  to: productionStatusSchema,
  reason: z.string().trim().max(2000).optional(),
});

export type ProductionOrderContract = z.infer<
  typeof productionOrderContractSchema
>;
export type ProductionTransitionContract = z.infer<
  typeof productionTransitionContractSchema
>;
export type CanonicalProductionStatus = ProductionStatus;