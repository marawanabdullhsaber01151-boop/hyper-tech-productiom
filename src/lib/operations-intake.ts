import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  contactsTable,
  operationsCaseLinesTable,
  operationsCaseRevisionsTable,
  operationsCasesTable,
  salesOrderItemsTable,
  salesOrdersTable,
  stockMovementsTable,
} from "../db/schema";
import { nextPhase0Number } from "./phase0";
import { writeAuditEvent } from "./governance";
import {
  isNonNegativeDecimalQuantity,
  isPositiveDecimalQuantity,
} from "./decimal-quantity";

type TransactionExecutor = {
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
  update: (...args: any[]) => any;
};

export const operationsIntakeRequestSchema = z.object({
  salesOrderRevision: z.number().int().positive().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

export const VALID_OPERATIONS_SALES_STATUSES = [
  "confirmed",
  "shipped",
  "paid",
] as const;

export function parseSalesOrderRevision(input: unknown): number {
  if (input === undefined || input === null || input === "") return 1;
  if (
    typeof input !== "number" ||
    !Number.isSafeInteger(input) ||
    input <= 0
  ) {
    throw Object.assign(new Error("نسخة أمر البيع غير صالحة"), { status: 400 });
  }
  return input;
}

export function findMissingStockMovementLines(
  items: Array<{
    id: number;
    inventoryItemId: number | null;
    description: string;
    qty: string;
  }>,
  movements: Array<{ inventoryItemId: number | null }>,
) {
  const movedInventoryItemIds = new Set(
    movements
      .map((movement) => movement.inventoryItemId)
      .filter((id): id is number => id !== null),
  );

  return items
    .filter(
      (item) =>
        item.inventoryItemId !== null &&
        !movedInventoryItemIds.has(item.inventoryItemId),
    )
    .map((item) => ({
      salesOrderItemId: item.id,
      inventoryItemId: item.inventoryItemId,
      productName: item.description,
      orderedQty: item.qty,
    }));
}

export function customerDisplayName(
  customer: { name: string | null; company: string | null } | null,
): string | null {
  if (!customer?.name) return null;
  return customer.company ? `${customer.name} — ${customer.company}` : customer.name;
}

export function buildSalesOrderSnapshot(input: {
  order: {
    id: number;
    orderNumber: string;
    status: string;
    date: string;
    dueDate: string | null;
    channel: string;
    notes: string | null;
    subtotal: string;
    total: string;
  };
  customer: {
    id: number | null;
    name: string | null;
    company: string | null;
  } | null;
  items: Array<{
    id: number;
    inventoryItemId: number | null;
    description: string;
    qty: string;
    baseUnit?: string | null;
    packagingQty?: string | null;
    packagingUnit?: string | null;
    conversionFactor?: string | null;
    unitPrice: string;
    total: string;
  }>;
  salesOrderRevision: number;
  capturedAt?: string;
}) {
  const displayName = customerDisplayName(input.customer);
  return {
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    salesOrderRevision: input.salesOrderRevision,
    salesOrder: {
      id: input.order.id,
      orderNumber: input.order.orderNumber,
      status: input.order.status,
      date: input.order.date,
      dueDate: input.order.dueDate,
      channel: input.order.channel,
      notes: input.order.notes,
      subtotal: input.order.subtotal,
      total: input.order.total,
    },
    customer: {
      id: input.customer?.id ?? null,
      displayName,
    },
    lines: input.items.map((item) => ({
      salesOrderItemId: item.id,
      inventoryItemId: item.inventoryItemId,
      productName: item.description,
      orderedQty: item.qty,
      unitPrice: item.unitPrice,
      total: item.total,
      baseUnit: item.baseUnit ?? "unit",
      packagingQty: item.packagingQty ?? "0",
      packagingUnit: item.packagingUnit ?? "carton",
      conversionFactor: item.conversionFactor ?? "1",
      dueDate: input.order.dueDate,
    })),
  };
}

export function validateOperationsSnapshot(snapshot: ReturnType<typeof buildSalesOrderSnapshot>) {
  if (!snapshot.lines.length) {
    throw intakeError("لا يمكن استقبال أمر بيع بلا سطور", 422);
  }

  for (const line of snapshot.lines) {
    if (!line.productName.trim()) {
      throw intakeError("اسم الصنف مطلوب لكل سطر", 422);
    }
    if (!isPositiveDecimalQuantity(line.orderedQty)) {
      throw intakeError("كمية الطلب يجب أن تكون أكبر من صفر", 422);
    }
    if (!line.baseUnit.trim() || !line.packagingUnit.trim()) {
      throw intakeError("وحدتا الأساس والتعبئة مطلوبتان", 422);
    }
    if (!isNonNegativeDecimalQuantity(line.packagingQty)) {
      throw intakeError("كمية التعبئة لا يمكن أن تكون سالبة", 422);
    }
    if (!isPositiveDecimalQuantity(line.conversionFactor)) {
      throw intakeError("معامل التحويل يجب أن يكون أكبر من صفر", 422);
    }
  }
}

function intakeError(message: string, status = 422) {
  return Object.assign(new Error(message), { status });
}

async function existingCase(
  tx: TransactionExecutor,
  salesOrderId: number,
  salesOrderRevision: number,
) {
  const [existing] = await tx
    .select()
    .from(operationsCasesTable)
    .where(
      and(
        eq(operationsCasesTable.salesOrderId, salesOrderId),
        eq(operationsCasesTable.salesOrderRevision, salesOrderRevision),
      ),
    )
    .limit(1)
    .for("update");
  if (!existing) return null;
  const lines = await tx
    .select()
    .from(operationsCaseLinesTable)
    .where(eq(operationsCaseLinesTable.caseId, existing.id));
  return { case: existing, lines };
}

export async function receiveSalesOrderIntoOperations(
  tx: TransactionExecutor,
  input: {
    salesOrderId: number;
    salesOrderRevision?: number;
    priority: "low" | "normal" | "high" | "urgent";
    createdBy: number;
    actorName: string;
    ipAddress?: string;
    userAgent?: string;
  },
) {
  if (input.salesOrderRevision !== undefined) {
    const duplicate = await existingCase(
      tx,
      input.salesOrderId,
      input.salesOrderRevision,
    );
    if (duplicate) return { ...duplicate, created: false };
  }

  const [order] = await tx
    .select()
    .from(salesOrdersTable)
    .where(eq(salesOrdersTable.id, input.salesOrderId))
    .limit(1)
    .for("update");

  if (!order) throw intakeError("أمر البيع غير موجود", 404);
  const salesOrderRevision = input.salesOrderRevision ?? order.revision;
  if (
    input.salesOrderRevision !== undefined &&
    input.salesOrderRevision !== order.revision
  ) {
    throw intakeError(
      "نسخة أمر البيع قديمة أو غير مطابقة للنسخة الحالية",
      409,
    );
  }
  const duplicate = await existingCase(
    tx,
    input.salesOrderId,
    salesOrderRevision,
  );
  if (duplicate) return { ...duplicate, created: false };
  if (
    !(VALID_OPERATIONS_SALES_STATUSES as readonly string[]).includes(
      order.status,
    )
  ) {
    throw intakeError(
      "لا يمكن استقبال أمر البيع قبل اعتماده في Sales",
      409,
    );
  }

  const items = await tx
    .select()
    .from(salesOrderItemsTable)
    .where(eq(salesOrderItemsTable.orderId, input.salesOrderId));
  if (items.length === 0) {
    throw intakeError("لا يمكن استقبال أمر بيع بلا سطور", 422);
  }

  if (["shipped", "paid"].includes(order.status)) {
    const stockMovements = await tx
      .select({ inventoryItemId: stockMovementsTable.inventoryItemId })
      .from(stockMovementsTable)
      .where(
        and(
          eq(stockMovementsTable.referenceType, "sales_order"),
          eq(stockMovementsTable.referenceId, input.salesOrderId),
          eq(stockMovementsTable.movementType, "out"),
        ),
      );
    const missingStockMovementLines = findMissingStockMovementLines(
      items,
      stockMovements,
    );

    if (missingStockMovementLines.length > 0) {
      const details = {
        salesOrderId: input.salesOrderId,
        salesOrderStatus: order.status,
        missingStockMovementLines,
      };

      await writeAuditEvent({
        executor: tx,
        actorUserId: input.createdBy,
        actorName: input.actorName,
        actionKey: "operations.case.rejectedInconsistentStock",
        resourceType: "sales_order",
        resourceId: input.salesOrderId,
        afterData: details,
        decision: "rejected",
        reason: "Sales order status has no matching outbound stock movement",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      throw Object.assign(
        intakeError(
          `أمر البيع ده وصل لحالة ${order.status} بدون أثر حقيقي على المخزون — راجع فريق المبيعات قبل الاستقبال`,
          409,
        ),
        {
          code: "INCONSISTENT_STOCK",
          details,
        },
      );
    }
  }

  const [customer] = order.contactId
    ? await tx
        .select({
          id: contactsTable.id,
          name: contactsTable.name,
          company: contactsTable.company,
        })
        .from(contactsTable)
        .where(eq(contactsTable.id, order.contactId))
        .limit(1)
    : [];

  const snapshot = buildSalesOrderSnapshot({
    order,
    customer: customer ?? null,
    items,
    salesOrderRevision,
  });
  validateOperationsSnapshot(snapshot);
  const caseNumber = await nextPhase0Number(tx, "operations_case");
  const [created] = await tx
    .insert(operationsCasesTable)
    .values({
      caseNumber,
      salesOrderId: input.salesOrderId,
      salesOrderRevision,
      status: "received",
      priority: input.priority,
      dueDate: order.dueDate,
      customerId: customer?.id ?? null,
      customerDisplayName: customerDisplayName(customer ?? null),
      sourceSnapshot: snapshot,
      currentRevision: 1,
      version: 1,
      createdBy: input.createdBy,
    })
    .onConflictDoNothing({
      target: [
        operationsCasesTable.salesOrderId,
        operationsCasesTable.salesOrderRevision,
      ],
    })
    .returning();

  // A concurrent retry can win the unique constraint after the initial
  // duplicate check. Return that committed case instead of creating a second
  // case or returning a transient error.
  if (!created) {
    const raced = await existingCase(
      tx,
      input.salesOrderId,
      salesOrderRevision,
    );
    if (!raced) throw intakeError("تعذر قراءة حالة التشغيل بعد التكرار", 409);
    return { ...raced, created: false };
  }

  const lines = await tx
    .insert(operationsCaseLinesTable)
    .values(
      snapshot.lines.map((line) => ({
        caseId: created.id,
        salesOrderItemId: line.salesOrderItemId,
        inventoryItemId: line.inventoryItemId,
        productNameSnapshot: line.productName,
        orderedQty: line.orderedQty,
        baseUnit: line.baseUnit,
        packagingQty: line.packagingQty,
        packagingUnit: line.packagingUnit,
        conversionFactor: line.conversionFactor,
        dueDate: line.dueDate,
        lineStatus: "received",
      })),
    )
    .returning();

  await tx.insert(operationsCaseRevisionsTable).values({
    caseId: created.id,
    revision: 1,
    snapshot,
    changeReason: "sales_order_received",
    changedBy: input.createdBy,
  });

  await writeAuditEvent({
    executor: tx,
    actorUserId: input.createdBy,
    actorName: input.actorName,
    actionKey: "operations.case.received",
    resourceType: "operations_case",
    resourceId: created.id,
    afterData: {
      caseId: created.id,
      caseNumber: created.caseNumber,
      salesOrderId: created.salesOrderId,
      salesOrderRevision: created.salesOrderRevision,
      status: created.status,
      lineCount: lines.length,
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return { case: created, lines, created: true };
}