/** @format */

import { Router } from "express";
import {
  SQL,
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import {
  db,
  contactsTable,
  inventoryItemsTable,
  salesOrdersTable,
  salesOrderItemsTable,
  insertSalesOrderSchema,
  insertSalesOrderItemSchema,
} from "../db";
import {
  requireAuth,
  requireRole,
  requirePermission,
} from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { applyStockMovement, releaseStockReservation, reserveStock } from "../lib/stock";
import { moveToTrash } from "../lib/trash";
import { PERMISSIONS } from "../lib/permissions";
import { maskFields } from "../lib/fieldMasking";
import { z } from "zod";
import { createApprovalRequest } from "../lib/approvals";
import { writeAuditEvent } from "../lib/governance";
import {
  computeStockAndBalanceEffects,
  getSalesOrderStockState,
  isSalesOrderStatus,
  type SalesOrderStatus,
  type SalesStatusTransitionPlan,
} from "../lib/salesStatusTransition";

const router = Router();

const createSalesOrderSchema = insertSalesOrderSchema.extend({
  items: z.array(insertSalesOrderItemSchema.omit({ orderId: true })).optional(),
});

const salesOrderItemInputSchema = insertSalesOrderItemSchema.omit({
  orderId: true,
});

const updateSalesOrderSchema = insertSalesOrderSchema
  .omit({ subtotal: true, total: true })
  .partial()
  .extend({
    items: z.array(salesOrderItemInputSchema).optional(),
  });

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SalesOrderItemInput = z.infer<typeof salesOrderItemInputSchema>;
type NormalizedSalesOrderItem = Omit<SalesOrderItemInput, "unitPrice" | "total"> & {
  unitPrice: string;
  total: string;
};

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

function errorWithStatus(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}

function parseScaledDecimal(value: string, scale: number, label: string): bigint {
  if (!DECIMAL_PATTERN.test(value)) {
    throw errorWithStatus(`${label} يجب أن يكون رقمًا عشريًا صالحًا`);
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) {
    throw errorWithStatus(`${label} لا يدعم أكثر من ${scale} منازل عشرية`);
  }
  return (
    BigInt(whole) * 10n ** BigInt(scale) +
    BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0")
  );
}

function centsToMoney(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function multiplyQuantityByPrice(qty: string, unitPrice: string): string {
  const quantityInMilliunits = parseScaledDecimal(qty, 3, "الكمية");
  const priceInCents = parseScaledDecimal(unitPrice, 2, "سعر الوحدة");
  const rawCents = quantityInMilliunits * priceInCents;
  const roundedCents = (rawCents + 500n) / 1000n;
  return centsToMoney(roundedCents);
}

function sumItemTotals(items: Array<{ total: string }>): string {
  const cents = items.reduce(
    (sum, item) => sum + parseScaledDecimal(item.total, 2, "إجمالي البند"),
    0n,
  );
  return centsToMoney(cents);
}

function centsDifference(newAmount: string, oldAmount: string): string {
  return centsToMoney(
    parseScaledDecimal(newAmount, 2, "الإجمالي الجديد") -
      parseScaledDecimal(oldAmount, 2, "الإجمالي السابق"),
  );
}

function isOutstandingStatus(status: SalesOrderStatus): boolean {
  return status === "confirmed" || status === "shipped";
}

async function normalizeSalesOrderItems(
  tx: Transaction,
  items: SalesOrderItemInput[],
) {
  const inventoryIds = [
    ...new Set(
      items
        .map((item) => item.inventoryItemId)
        .filter((id): id is number => id !== null && id !== undefined),
    ),
  ];
  const inventoryRows =
    inventoryIds.length > 0 ?
      await tx
        .select()
        .from(inventoryItemsTable)
        .where(inArray(inventoryItemsTable.id, inventoryIds))
        .for("update")
    : [];
  const inventoryById = new Map(inventoryRows.map((item) => [item.id, item]));
  const priceOverrides: Array<{
    inventoryItemId: number;
    requestedUnitPrice: string;
    authoritativeUnitPrice: string;
  }> = [];
  const manualPriceOverrides: Array<{
    description: string;
    qty: string;
    unitPrice: string;
  }> = [];

  const normalizedItems = items.map((item) => {
    const inventoryItem =
      item.inventoryItemId === null || item.inventoryItemId === undefined ?
        null
      : inventoryById.get(item.inventoryItemId);
    if (item.inventoryItemId && !inventoryItem) {
      throw errorWithStatus(
        `الصنف رقم ${item.inventoryItemId} غير موجود في المخزون`,
        404,
      );
    }

    const requestedUnitPrice = item.unitPrice;
    const unitPrice = inventoryItem?.unitPrice ?? requestedUnitPrice;
    parseScaledDecimal(item.qty, 3, "الكمية");
    parseScaledDecimal(unitPrice, 2, "سعر الوحدة");
    if (inventoryItem && requestedUnitPrice !== inventoryItem.unitPrice) {
      priceOverrides.push({
        inventoryItemId: inventoryItem.id,
        requestedUnitPrice,
        authoritativeUnitPrice: inventoryItem.unitPrice,
      });
    } else if (!inventoryItem) {
      manualPriceOverrides.push({
        description: item.description,
        qty: item.qty,
        unitPrice: requestedUnitPrice,
      });
    }

    return {
      ...item,
      description: item.description.trim(),
      unitPrice,
      total: multiplyQuantityByPrice(item.qty, unitPrice),
    };
  });

  return {
    items: normalizedItems,
    subtotal: sumItemTotals(normalizedItems),
    total: sumItemTotals(normalizedItems),
    priceOverrides,
    manualPriceOverrides,
  };
}

async function replaceSalesOrderItems(
  tx: Transaction,
  order: typeof salesOrdersTable.$inferSelect,
  oldItems: typeof salesOrderItemsTable.$inferSelect[],
  newItems: NormalizedSalesOrderItem[],
  oldStockState: ReturnType<typeof getItemStockEffect>,
  newStockState: ReturnType<typeof getItemStockEffect>,
  req: { user?: { userId: number; username: string } },
) {
  if (oldStockState === "reserved") {
    for (const item of oldItems) {
      if (item.inventoryItemId) {
        await releaseStockReservation(tx, item.inventoryItemId, item.qty);
      }
    }
  } else if (oldStockState === "deducted") {
    for (const item of oldItems) {
      if (item.inventoryItemId) {
        await applyStockMovement(tx, {
          inventoryItemId: item.inventoryItemId,
          movementType: "in",
          qty: item.qty,
          referenceType: "sales_order",
          referenceId: order.id,
          unitPrice: item.unitPrice,
          notes: `استرجاع مؤقت لإعادة بناء بنود أمر البيع رقم ${order.orderNumber}`,
        });
      }
    }
  }

  for (const item of oldItems) {
    await moveToTrash(
      tx,
      "sales_order_items",
      item,
      req.user!.userId,
      req.user!.username,
      order.orderNumber,
    );
  }
  await tx.delete(salesOrderItemsTable).where(eq(salesOrderItemsTable.orderId, order.id));

  const insertedItems =
    newItems.length > 0 ?
      await tx
        .insert(salesOrderItemsTable)
        .values(newItems.map((item) => ({ ...item, orderId: order.id })))
        .returning()
    : [];

  if (newStockState === "reserved") {
    for (const item of insertedItems) {
      if (item.inventoryItemId) {
        await reserveStock(tx, item.inventoryItemId, item.qty);
      }
    }
  } else if (newStockState === "deducted") {
    for (const item of insertedItems) {
      if (item.inventoryItemId) {
        await applyStockMovement(tx, {
          inventoryItemId: item.inventoryItemId,
          movementType: "out",
          qty: item.qty,
          referenceType: "sales_order",
          referenceId: order.id,
          unitPrice: item.unitPrice,
          notes: `خصم تلقائي بعد تحديث بنود أمر البيع رقم ${order.orderNumber}`,
        });
      }
    }
  }

  return insertedItems;
}

function uniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

async function writePriceOverrideAudits(
  tx: Transaction,
  req: {
    user?: { userId: number; username: string };
    ip?: string;
    get(name: string): string | undefined;
  },
  resourceId: number,
  normalized: {
    priceOverrides: Array<{
      inventoryItemId: number;
      requestedUnitPrice: string;
      authoritativeUnitPrice: string;
    }>;
    manualPriceOverrides: Array<{
      description: string;
      qty: string;
      unitPrice: string;
    }>;
  },
) {
  for (const override of normalized.priceOverrides) {
    await writeAuditEvent({
       actorUserId: req.user!.userId,
       actorName: req.user!.username,
      actionKey: "sales.price_override",
      resourceType: "sales_order",
      resourceId,
      afterData: override,
      reason: "تم استخدام سعر المخزون المعتمد بدل السعر المرسل من الواجهة",
       ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent"),
      executor: tx,
    });
  }
  for (const override of normalized.manualPriceOverrides) {
    await writeAuditEvent({
       actorUserId: req.user!.userId,
       actorName: req.user!.username,
      actionKey: "sales.manual_price_override",
      resourceType: "sales_order",
      resourceId,
      afterData: override,
      reason: "سعر يدوي لبند غير مربوط بصنف مخزني",
       ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent"),
      executor: tx,
    });
  }
}

function salesStatusOrThrow(status: string): SalesOrderStatus {
  if (!isSalesOrderStatus(status)) {
    throw Object.assign(new Error(`حالة أمر البيع غير معروفة: ${status}`), {
      status: 409,
    });
  }
  return status;
}

function throwIfForbiddenTransition(plan: SalesStatusTransitionPlan) {
  if (!plan.allowed) {
    throw Object.assign(new Error(plan.reason ?? "انتقال حالة أمر البيع غير مسموح"), {
      status: 409,
    });
  }
}

async function applySalesTransitionPlan(
  tx: Transaction,
  plan: SalesStatusTransitionPlan,
  items: Array<{
    inventoryItemId: number | null;
    qty: string;
    unitPrice: string;
  }>,
  order: {
    id: number;
    orderNumber: string;
    contactId: number | null;
    total: string;
  },
) {
  for (const effect of plan.effects) {
    // Phase 2: "increaseBalance"/"decreaseBalance" effects removed along with
    // the contact-balance/credit-ledger feature (no accounting logic in this
    // system). Only stock effects remain relevant here.
    if (effect === "increaseBalance" || effect === "decreaseBalance") {
      continue;
    }

    for (const item of items) {
      if (!item.inventoryItemId) continue;
      if (effect === "reserve") {
        await reserveStock(tx, item.inventoryItemId, item.qty);
      } else if (effect === "releaseReservation") {
        await releaseStockReservation(tx, item.inventoryItemId, item.qty);
      } else if (effect === "deductStock") {
        await applyStockMovement(tx, {
          inventoryItemId: item.inventoryItemId,
          movementType: "out",
          qty: item.qty,
          referenceType: "sales_order",
          referenceId: order.id,
          unitPrice: item.unitPrice,
          notes: `خصم تلقائي عند انتقال أمر بيع رقم ${order.orderNumber} إلى ${plan.toStatus}`,
        });
      } else if (effect === "restoreStock") {
        await applyStockMovement(tx, {
          inventoryItemId: item.inventoryItemId,
          movementType: "in",
          qty: item.qty,
          referenceType: "sales_order",
          referenceId: order.id,
          unitPrice: item.unitPrice,
          notes: `استرجاع تلقائي عند إلغاء أمر بيع رقم ${order.orderNumber}`,
        });
      }
    }
  }
}

function requiresApproval(plan: SalesStatusTransitionPlan): boolean {
  return plan.effects.includes("reserve");
}

function getItemStockEffect(status: SalesOrderStatus) {
  return getSalesOrderStockState(status);
}

// GET /api/v1/sales/integrity-report
// Read-only report for historical orders/reservations affected before the
// central transition planner was introduced.
router.get(
  "/sales/integrity-report",
  requireAuth,
  requireRole("chairman"),
  async (_req, res, next) => {
    try {
      const [missingStockMovements, orphanedReservations] = await Promise.all([
        db.execute(sql`
          SELECT
            so.id,
            so.order_number AS "orderNumber",
            so.status,
            soi.id AS "itemId",
            soi.inventory_item_id AS "inventoryItemId",
            ii.name AS "inventoryItemName",
            soi.qty::numeric AS "requestedQty",
            COALESCE(SUM(
              CASE
                WHEN sm.movement_type = 'out' THEN sm.qty::numeric
                ELSE 0
              END
            ), 0)::numeric AS "outboundQty"
          FROM sales_orders so
          INNER JOIN sales_order_items soi ON soi.order_id = so.id
          INNER JOIN inventory_items ii ON ii.id = soi.inventory_item_id
          LEFT JOIN stock_movements sm
            ON sm.reference_type = 'sales_order'
           AND sm.reference_id = so.id
           AND sm.inventory_item_id = soi.inventory_item_id
          WHERE so.status IN ('shipped', 'paid')
          GROUP BY
            so.id, so.order_number, so.status, soi.id,
            soi.inventory_item_id, ii.name, soi.qty
          HAVING COALESCE(SUM(
            CASE
              WHEN sm.movement_type = 'out' THEN sm.qty::numeric
              ELSE 0
            END
          ), 0) < soi.qty::numeric
          ORDER BY so.id, soi.id
        `),
        db.execute(sql`
          SELECT
            ii.id AS "inventoryItemId",
            ii.code,
            ii.name,
            ii.reserved_qty::numeric AS "reservedQty",
            COALESCE(SUM(
              CASE
                WHEN so.status = 'confirmed' THEN soi.qty::numeric
                ELSE 0
              END
            ), 0)::numeric AS "confirmedQty",
            (
              ii.reserved_qty::numeric - COALESCE(SUM(
                CASE
                  WHEN so.status = 'confirmed' THEN soi.qty::numeric
                  ELSE 0
                END
              ), 0)::numeric
            )::numeric AS "excessReservedQty"
          FROM inventory_items ii
          LEFT JOIN sales_order_items soi
            ON soi.inventory_item_id = ii.id
          LEFT JOIN sales_orders so
            ON so.id = soi.order_id
          GROUP BY ii.id, ii.code, ii.name, ii.reserved_qty
          HAVING ii.reserved_qty::numeric > 0
             AND ii.reserved_qty::numeric > COALESCE(SUM(
               CASE
                 WHEN so.status = 'confirmed' THEN soi.qty::numeric
                 ELSE 0
               END
             ), 0)::numeric
          ORDER BY ii.id
        `),
      ]);

      res.json({
        generatedAt: new Date().toISOString(),
        readOnly: true,
        missingStockMovements: missingStockMovements.rows,
        orphanedReservations: orphanedReservations.rows,
        summary: {
          missingStockMovementItems: missingStockMovements.rows.length,
          orphanedReservationItems: orphanedReservations.rows.length,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/sales
router.get(
  "/sales",
  requireAuth,
  requireRole(...PERMISSIONS.sales.view),
  async (req, res, next) => {
    try {
      const queryParams = req.query as Record<string, string | undefined>;
      const paginated =
        queryParams.page !== undefined || queryParams.page_size !== undefined;
      const page = Math.max(Number.parseInt(queryParams.page ?? "1", 10) || 1, 1);
      const pageSize = Math.min(
        Math.max(Number.parseInt(queryParams.page_size ?? "15", 10) || 15, 1),
        100,
      );
      const status = queryParams.status;
      const contactId = queryParams.contact_id
        ? Number.parseInt(queryParams.contact_id, 10)
        : null;
      const search = queryParams.search?.trim();
      const dateFrom = queryParams.date_from;
      const dateTo = queryParams.date_to;

      const baseFilters: SQL[] = [];
      if (status) {
        salesStatusOrThrow(status);
      }
      if (contactId !== null && Number.isInteger(contactId)) {
        baseFilters.push(eq(salesOrdersTable.contactId, contactId));
      }
      if (search) {
        const pattern = `%${search}%`;
        baseFilters.push(
          sql`(${ilike(salesOrdersTable.orderNumber, pattern)} OR ${ilike(contactsTable.name, pattern)})`,
        );
      }
      if (dateFrom) baseFilters.push(gte(salesOrdersTable.date, dateFrom));
      if (dateTo) baseFilters.push(lte(salesOrdersTable.date, dateTo));
      if (["online_seller", "offline_seller"].includes(req.user!.role)) {
        baseFilters.push(eq(salesOrdersTable.createdById, req.user!.userId));
      }

      const filteredFilters = status
        ? [...baseFilters, eq(salesOrdersTable.status, status)]
        : baseFilters;
      const whereBase = baseFilters.length ? and(...baseFilters) : undefined;
      const whereFiltered = filteredFilters.length
        ? and(...filteredFilters)
        : undefined;

      const ordersQuery = db
        .select({ order: salesOrdersTable })
        .from(salesOrdersTable)
        .leftJoin(contactsTable, eq(salesOrdersTable.contactId, contactsTable.id))
        .where(whereFiltered)
        .orderBy(desc(salesOrdersTable.createdAt))
        .$dynamic();
      const ordersPromise = paginated
        ? ordersQuery.limit(pageSize).offset((page - 1) * pageSize)
        : ordersQuery;

      const [summaryRows, statusRows, totalRows, orders] = await Promise.all([
        db
          .select({
            total: count(),
            revenue: sql<string>`coalesce(sum(case when ${salesOrdersTable.status} = 'paid' then ${salesOrdersTable.total} else 0 end), 0)`,
            pending: sql<number>`count(*) filter (where ${salesOrdersTable.status} in ('draft', 'confirmed'))`,
            customers: countDistinct(salesOrdersTable.contactId),
          })
          .from(salesOrdersTable)
          .leftJoin(contactsTable, eq(salesOrdersTable.contactId, contactsTable.id))
          .where(whereBase),
        db
          .select({
            status: salesOrdersTable.status,
            count: count(),
          })
          .from(salesOrdersTable)
          .leftJoin(contactsTable, eq(salesOrdersTable.contactId, contactsTable.id))
          .where(whereBase)
          .groupBy(salesOrdersTable.status),
        db
          .select({ total: count() })
          .from(salesOrdersTable)
          .leftJoin(contactsTable, eq(salesOrdersTable.contactId, contactsTable.id))
          .where(whereFiltered),
        ordersPromise,
      ]);

      const summary = summaryRows[0] ?? {
        total: 0,
        revenue: "0",
        pending: 0,
        customers: 0,
      };
      const statusCounts = Object.fromEntries(
        statusRows.map((row) => [row.status, Number(row.count)]),
      );
      const orderItems = orders.map(({ order }) => order);
      if (!paginated) {
        res.json(orderItems);
        return;
      }
      res.json({
        items: orderItems,
        pagination: {
          page,
          pageSize,
          total: Number(totalRows[0]?.total ?? 0),
          totalPages: Math.ceil(Number(totalRows[0]?.total ?? 0) / pageSize),
        },
        statusCounts,
        summary: {
          total: Number(summary.total),
          revenue: summary.revenue,
          pending: Number(summary.pending),
          customers: Number(summary.customers),
        },
      });
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        res.status((err as any).status).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// POST /api/v1/sales
router.post(
  "/sales",
  requireAuth,
  requirePermission("sales.create"),
  async (req, res, next) => {
    try {
      const {
        items,
        subtotal: postedSubtotal,
        total: postedTotal,
        ...orderData
      } = createSalesOrderSchema.parse(req.body);
      if (["online_seller", "offline_seller"].includes(req.user!.role)) {
        orderData.createdById = req.user!.userId;
        orderData.channel = req.user!.role === "online_seller" ? "website" : "direct";
      }

      const result = await db.transaction(async (tx) => {
        const requestedStatus = salesStatusOrThrow(orderData.status);
        const transitionPlan = computeStockAndBalanceEffects(
          "draft",
          requestedStatus,
        );
        throwIfForbiddenTransition(transitionPlan);
        const normalized = await normalizeSalesOrderItems(tx, items ?? []);

        const [order] = await tx
          .insert(salesOrdersTable)
          .values({
            ...orderData,
            subtotal: normalized.subtotal,
            total: normalized.total,
            stockSyncStatus: "synced",
          })
          .returning();

        if (normalized.items.length > 0) {
          await tx
            .insert(salesOrderItemsTable)
            .values(
              normalized.items.map((item) => ({
                ...item,
                orderId: order.id,
              })),
            );
        }

        const orderItems =
          items ?
            await tx
              .select()
              .from(salesOrderItemsTable)
              .where(eq(salesOrderItemsTable.orderId, order.id))
          : [];

        await applySalesTransitionPlan(tx, transitionPlan, orderItems, order);

        await writeAuditEvent({
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "sales.create",
          resourceType: "sales_order",
          resourceId: order.id,
          afterData: {
            ...order,
            items: orderItems,
            postedSubtotal,
            postedTotal,
            authoritativeSubtotal: normalized.subtotal,
            authoritativeTotal: normalized.total,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          executor: tx,
        });
        await writePriceOverrideAudits(tx, req, order.id, normalized);

        const approval = await createApprovalRequest({
          actionKey: "sales.approve",
          resourceType: "sales_order",
          resourceId: order.id,
          amount: Number(order.total),
          requestedBy: req.user!.userId,
          metadata: { orderNumber: order.orderNumber, originalStatus: order.status },
        }, tx);
        if (approval) {
          const [pending] = await tx
            .update(salesOrdersTable)
            .set({ status: "pending_approval", updatedAt: new Date() })
            .where(eq(salesOrdersTable.id, order.id))
            .returning();
          return { ...pending, items: orderItems, approvalRequestId: approval.request.id };
        }

        return { ...order, items: orderItems };
      });

      res.status(201).json(result);
    } catch (err) {
      if (uniqueConstraintError(err)) {
        res.status(409).json({
          error: {
            message:
              "رقم الفاتورة مستخدم بالفعل؛ أُوقفت العملية الثانية لمنع إنشاء فاتورة مكررة",
          },
        });
        return;
      }
      if (err instanceof Error && "status" in err) {
        res
          .status((err as any).status)
          .json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// GET /api/v1/sales/:id
router.get(
  "/sales/:id",
  requireAuth,
  requireRole(...PERMISSIONS.sales.view),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const [order] = await db
        .select()
        .from(salesOrdersTable)
        .where(eq(salesOrdersTable.id, id))
        .limit(1);

      if (!order) {
        res.status(404).json({ error: { message: "أمر البيع غير موجود" } });
        return;
      }

      const items = await db
        .select()
        .from(salesOrderItemsTable)
        .where(eq(salesOrderItemsTable.orderId, id));

       res.json({ ...order, items: maskFields("sales_order_items", items, req.user!.role) });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/sales/:id
// لو الحالة اتغيرت من "مش ملتزم بيها" لـ "ملتزم بيها" → يخصم المخزون
// لو الحالة اتغيرت من "ملتزم بيها" لـ "ملغي" → يرجّع المخزون
router.patch(
  "/sales/:id",
  requireAuth,
  requirePermission("sales.edit"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;
      const { items, ...data } = updateSalesOrderSchema.parse(req.body);

      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(salesOrdersTable)
          .where(eq(salesOrdersTable.id, id))
          .limit(1);

        if (!existing) {
          throw Object.assign(new Error("أمر البيع غير موجود"), {
            status: 404,
          });
        }

        const fromStatus = salesStatusOrThrow(existing.status);
        const toStatus = salesStatusOrThrow(data.status ?? existing.status);
        const transitionPlan = computeStockAndBalanceEffects(fromStatus, toStatus);
        throwIfForbiddenTransition(transitionPlan);
        const statusChanged = data.status !== undefined && data.status !== existing.status;
        const existingItems = await tx
          .select()
          .from(salesOrderItemsTable)
          .where(eq(salesOrderItemsTable.orderId, id))
          .for("update");
        const itemsChanged = items !== undefined;
        if (existing.status === "pending_approval" && (itemsChanged || Object.keys(data).length > 0)) {
          throw errorWithStatus(
            "لا يمكن تعديل أمر البيع أثناء انتظار الاعتماد؛ استخدم قرار طلب الاعتماد أولاً",
            409,
          );
        }

        const normalized = itemsChanged
          ? await normalizeSalesOrderItems(tx, items)
          : null;
        const nextTotal = normalized?.total ?? existing.total;
        const nextSubtotal = normalized?.subtotal ?? existing.subtotal;
        const updatedOrderData = {
          ...data,
          ...(itemsChanged
            ? { subtotal: nextSubtotal, total: nextTotal }
            : {}),
          ...(statusChanged ? { stockSyncStatus: "synced" as const } : {}),
          revision: existing.revision + 1,
          updatedAt: new Date(),
        };

        const [updated] = await tx
          .update(salesOrdersTable)
          .set(updatedOrderData)
          .where(eq(salesOrdersTable.id, id))
          .returning();

        if (itemsChanged) {
          const balancePlan = {
            ...transitionPlan,
            effects: transitionPlan.effects.filter(
              (effect) => effect === "increaseBalance" || effect === "decreaseBalance",
            ),
          };
          const balanceOrder = {
            ...updated,
            total:
              balancePlan.effects.includes("decreaseBalance") ?
                existing.total
              : updated.total,
          };
          await applySalesTransitionPlan(tx, balancePlan, [], balanceOrder);
          await replaceSalesOrderItems(
            tx,
            updated,
            existingItems,
            normalized!.items,
            getItemStockEffect(fromStatus),
            getItemStockEffect(toStatus),
            req,
          );
          // Phase 2: balance-correction on total change removed along with
          // the contact-balance/credit-ledger feature (no accounting logic
          // in this system).
        } else {
          await applySalesTransitionPlan(tx, transitionPlan, existingItems, {
            ...updated,
            total:
              transitionPlan.effects.includes("decreaseBalance") ?
                existing.total
              : updated.total,
          });
        }

        // ✅ إصلاح ثغرة حرجة: نظام الاعتماد (سقوف المبالغ المالية) كان
        // مطبَّق بس وقت إنشاء الفاتورة (POST) — أي بائع كان يقدر يعمل
        // فاتورة "مسودة" بأي مبلغ، وبعدين يعدّلها هنا (PATCH) ويحوّل
        // الحالة لـ"مؤكَّد" مباشرة، من غير ما يمر على أي فحص سقف أو
        // تصعيد اعتماد خالص — يعني تخطّي كامل لنظام الاعتماد بالكامل.
        // نفس الفحص المطبَّق وقت الإنشاء لازم يتكرر هنا بالظبط.
        if (requiresApproval(transitionPlan)) {
          const approval = await createApprovalRequest({
            actionKey: "sales.approve",
            resourceType: "sales_order",
            resourceId: updated.id,
            amount: Number(updated.total),
            requestedBy: req.user!.userId,
            metadata: { orderNumber: updated.orderNumber, originalStatus: toStatus },
          }, tx);
          if (approval) {
            const [pending] = await tx
              .update(salesOrdersTable)
              .set({
                status: "pending_approval",
                revision: updated.revision + 1,
                updatedAt: new Date(),
              })
              .where(eq(salesOrdersTable.id, id))
              .returning();
              await writeAuditEvent({
                actorUserId: req.user!.userId,
                actorName: req.user!.username,
                actionKey: statusChanged ? "sales.status_transition" : "sales.edit",
                resourceType: "sales_order",
                resourceId: updated.id,
                beforeData: { ...existing, items: existingItems },
                afterData: {
                  ...pending,
                  items: normalized?.items ?? existingItems,
                },
                reason: "تم تحديث أمر البيع وإحالته إلى الاعتماد",
                ipAddress: req.ip,
                userAgent: req.get("user-agent"),
                executor: tx,
              });
              if (normalized) {
                await writePriceOverrideAudits(tx, req, updated.id, normalized);
              }
              return {
                ...pending,
                items: normalized?.items ?? existingItems,
                approvalRequestId: approval.request.id,
              };
          }
        }

        if (statusChanged || itemsChanged) {
          await writeAuditEvent({
            actorUserId: req.user!.userId,
            actorName: req.user!.username,
            actionKey: statusChanged ? "sales.status_transition" : "sales.edit",
            resourceType: "sales_order",
            resourceId: updated.id,
            beforeData: {
              ...existing,
              items: existingItems,
            },
            afterData: {
              ...updated,
              items: normalized?.items ?? existingItems,
            },
            reason: statusChanged
              ? `انتقال الحالة من ${existing.status} إلى ${updated.status}`
              : "تعديل بيانات أو بنود أمر البيع",
            ipAddress: req.ip,
            userAgent: req.get("user-agent"),
            executor: tx,
          });
          if (normalized) {
            await writePriceOverrideAudits(tx, req, updated.id, normalized);
          }
        }

        const finalItems = itemsChanged
          ? await tx
              .select()
              .from(salesOrderItemsTable)
              .where(eq(salesOrderItemsTable.orderId, id))
          : existingItems;
        return { ...updated, items: finalItems };
      });

      res.json(result);
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        res
          .status((err as any).status)
          .json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// DELETE /api/v1/sales/:id
router.delete(
  "/sales/:id",
  requireAuth,
  requirePermission("sales.delete"),
  async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id, res);
      if (id === null) return;

      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(salesOrdersTable)
          .where(eq(salesOrdersTable.id, id))
          .limit(1);

        if (!existing) {
          throw Object.assign(new Error("أمر البيع غير موجود"), {
            status: 404,
          });
        }

        const status = salesStatusOrThrow(existing.status);
        if (status === "pending_approval") {
          throw Object.assign(
            new Error("أمر البيع في انتظار الاعتماد — استخدم قرار طلب الاعتماد أولاً"),
            { status: 409 },
          );
        }

        const deletionPlan = computeStockAndBalanceEffects(status, "cancelled");
        throwIfForbiddenTransition(deletionPlan);

        const items = await tx
          .select()
          .from(salesOrderItemsTable)
          .where(eq(salesOrderItemsTable.orderId, id));
        await applySalesTransitionPlan(tx, deletionPlan, items, existing);

        // ✅ نقل الفاتورة وبنودها للسلة قبل الحذف الفعلي
        for (const item of items) {
          await moveToTrash(
            tx,
            "sales_order_items",
            item,
            req.user!.userId,
            req.user!.username,
            existing.orderNumber,
          );
        }
        await moveToTrash(
          tx,
          "sales_orders",
          existing,
          req.user!.userId,
          req.user!.username,
          existing.orderNumber,
        );

        await writeAuditEvent({
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "sales.delete",
          resourceType: "sales_order",
          resourceId: existing.id,
          beforeData: { ...existing, items },
          reason: `حذف أمر البيع ونقله إلى سلة المحذوفات من الحالة ${existing.status}`,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          executor: tx,
        });
        await tx.delete(salesOrdersTable).where(eq(salesOrdersTable.id, id));
      });

      res.status(204).send();
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        res
          .status((err as any).status)
          .json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// POST /api/v1/sales/:id/items
router.post(
  "/sales/:id/items",
  requireAuth,
  requirePermission("sales.edit"),
  async (req, res, next) => {
    try {
      const orderId = parseIdParam(req.params.id, res);
      if (orderId === null) return;
      const data = insertSalesOrderItemSchema
        .omit({ orderId: true })
        .parse(req.body);

      const result = await db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(salesOrdersTable)
          .where(eq(salesOrdersTable.id, orderId))
          .limit(1);

        if (!order) {
          throw Object.assign(new Error("أمر البيع غير موجود"), {
            status: 404,
          });
        }
        if (order.status === "pending_approval" || order.status === "cancelled") {
          throw errorWithStatus(
            "لا يمكن إضافة بند إلى أمر البيع في هذه الحالة",
            409,
          );
        }
        const normalized = await normalizeSalesOrderItems(tx, [data]);
        const [item] = normalized.items.length
          ? await tx
              .insert(salesOrderItemsTable)
              .values({ ...normalized.items[0], orderId })
              .returning()
          : [];
        if (!item) throw errorWithStatus("تعذر إنشاء بند الفاتورة");

        const existingItems = await tx
          .select()
          .from(salesOrderItemsTable)
          .where(eq(salesOrderItemsTable.orderId, orderId));
        const nextTotal = sumItemTotals(existingItems);
        const orderStatus = salesStatusOrThrow(order.status);
        const stockState = getItemStockEffect(orderStatus);

        await tx
          .update(salesOrdersTable)
          .set({
            subtotal: nextTotal,
            total: nextTotal,
            revision: order.revision + 1,
            ...(stockState !== "none" ? { stockSyncStatus: "synced" as const } : {}),
            updatedAt: new Date(),
          })
          .where(eq(salesOrdersTable.id, orderId));

        if (item.inventoryItemId && stockState === "reserved") {
          await reserveStock(tx, item.inventoryItemId, item.qty);
        } else if (item.inventoryItemId && stockState === "deducted") {
          await applyStockMovement(tx, {
            inventoryItemId: item.inventoryItemId,
            movementType: "out",
            qty: item.qty,
            referenceType: "sales_order",
            referenceId: orderId,
            unitPrice: item.unitPrice,
            notes: `خصم تلقائي — إضافة بند لأمر بيع رقم ${order.orderNumber}`,
          });
        }
        // Phase 2: balance adjustment on item add removed along with the
        // contact-balance/credit-ledger feature (no accounting logic in
        // this system).
        await writeAuditEvent({
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "sales.edit",
          resourceType: "sales_order",
          resourceId: orderId,
          beforeData: { ...order, items: existingItems.filter((old) => old.id !== item.id) },
          afterData: { ...order, total: nextTotal, items: existingItems },
          reason: "إضافة بند إلى أمر البيع",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          executor: tx,
        });
        await writePriceOverrideAudits(tx, req, orderId, normalized);

        return item;
      });

      res.status(201).json(result);
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        res
          .status((err as any).status)
          .json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// DELETE /api/v1/sales/:id/items/:itemId
router.delete(
  "/sales/:id/items/:itemId",
  requireAuth,
  requirePermission("sales.edit"),
  async (req, res, next) => {
    try {
      const itemId = parseIdParam(req.params.itemId, res);
      if (itemId === null) return;
      const orderId = parseIdParam(req.params.id, res);
      if (orderId === null) return;

      await db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(salesOrdersTable)
          .where(eq(salesOrdersTable.id, orderId))
          .limit(1);

        if (!order) {
          throw Object.assign(new Error("أمر البيع غير موجود"), {
            status: 404,
          });
        }
        if (order.status === "pending_approval" || order.status === "cancelled") {
          throw errorWithStatus(
            "لا يمكن حذف بند من أمر البيع في هذه الحالة",
            409,
          );
        }

        const [item] = await tx
          .select()
          .from(salesOrderItemsTable)
          .where(
            and(
              eq(salesOrderItemsTable.id, itemId),
              eq(salesOrderItemsTable.orderId, orderId),
            ),
          )
          .limit(1);
        if (!item) {
          throw errorWithStatus("بند الفاتورة غير موجود", 404);
        }

        const remainingItems = await tx
          .select()
          .from(salesOrderItemsTable)
          .where(eq(salesOrderItemsTable.orderId, orderId));
        const nextTotal = sumItemTotals(
          remainingItems.filter((candidate) => candidate.id !== item.id),
        );

        const orderStatus = salesStatusOrThrow(order.status);
        const stockState = getItemStockEffect(orderStatus);

        if (item?.inventoryItemId && stockState === "reserved") {
          await releaseStockReservation(tx, item.inventoryItemId, item.qty);
        } else if (item?.inventoryItemId && stockState === "deducted") {
          await applyStockMovement(tx, {
            inventoryItemId: item.inventoryItemId, movementType: "in", qty: item.qty,
            referenceType: "sales_order", referenceId: orderId, unitPrice: item.unitPrice,
            notes: `استرجاع تلقائي — حذف بند من أمر بيع رقم ${order.orderNumber}`,
          });
        }

        await moveToTrash(
          tx,
          "sales_order_items",
          item,
          req.user!.userId,
          req.user!.username,
          order.orderNumber,
        );

        await tx
          .delete(salesOrderItemsTable)
          .where(
            and(
              eq(salesOrderItemsTable.id, itemId),
              eq(salesOrderItemsTable.orderId, orderId),
            ),
          );
        await tx
          .update(salesOrdersTable)
          .set({
            subtotal: nextTotal,
            total: nextTotal,
            revision: order.revision + 1,
            ...(stockState !== "none" ? { stockSyncStatus: "synced" as const } : {}),
            updatedAt: new Date(),
          })
          .where(eq(salesOrdersTable.id, orderId));
        // Phase 2: balance adjustment on item delete removed along with the
        // contact-balance/credit-ledger feature (no accounting logic in
        // this system).
        await writeAuditEvent({
          actorUserId: req.user!.userId,
          actorName: req.user!.username,
          actionKey: "sales.edit",
          resourceType: "sales_order",
          resourceId: orderId,
          beforeData: { ...order, items: remainingItems },
          afterData: { ...order, subtotal: nextTotal, total: nextTotal, items: remainingItems.filter((candidate) => candidate.id !== item.id) },
          reason: "حذف بند من أمر البيع",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          executor: tx,
        });
      });

      res.status(204).send();
    } catch (err) {
      if (err instanceof Error && "status" in err) {
        res
          .status((err as any).status)
          .json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  },
);

export default router;
