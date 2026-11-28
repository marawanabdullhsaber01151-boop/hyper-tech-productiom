/** @format */
// المخازن - المرحلة ب: قايمة المخازن بنوعها، إنشاء وتعديل وإيقاف، تعيين أمناء المخزن، وأرصدة النوع (مجمّع/منفصل).
import { Router } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { inventoryItemsTable, stockBalancesTable, systemUsersTable, warehouseKeepersTable, warehousesTable } from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { findPostgresError } from "../middleware/errorHandler";
import { parseIdParam } from "../lib/validate";
import { writeAuditEvent } from "../lib/governance";
import { WAREHOUSE_MANAGE_ROLES, WAREHOUSE_VIEW_ROLES, codeFor, combineStock, inScope, kindsFor, nameProblem, normalizeName, type StockRow } from "../lib/warehouseAccess";
import { isKind, type WarehouseKind } from "../lib/warehouseCore";
import { warehouseScopeOf } from "../lib/warehouseScope";

const router = Router();

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

const scopeOf = warehouseScopeOf;

const send = (res: import("express").Response, next: import("express").NextFunction, e: unknown) => {
  if (e instanceof Error && "status" in e) {
    res.status((e as Error & { status: number }).status).json({ error: { message: e.message } });
    return;
  }
  const pg = findPostgresError(e);
  if (pg?.code === "23505") {
    res.status(409).json({ error: { message: "فيه مخزن بنفس الاسم في النوع ده" } });
    return;
  }
  next(e);
};

// GET /api/v1/warehouses — المخازن اللي الدور يشوفها (بنوعها ونطاق أمين المخزن) + عدد أصنافها وأمناؤها
router.get("/warehouses", requireAuth, requireRole(...WAREHOUSE_VIEW_ROLES), async (req, res, next) => {
  try {
    const role = req.user!.role;
    const kinds = kindsFor(role);
    const scope = await scopeOf(role, req.user!.userId);
    const rows = await db.select().from(warehousesTable).where(inArray(warehousesTable.kind, kinds)).orderBy(asc(warehousesTable.kind), asc(warehousesTable.id));
    const visible = rows.filter((w) => inScope(scope, w.id));
    const ids = visible.map((w) => w.id);
    const counts = ids.length
      ? await db.select({ warehouseId: stockBalancesTable.warehouseId, n: sql<number>`count(*)::int` }).from(stockBalancesTable)
          .where(and(inArray(stockBalancesTable.warehouseId, ids), sql`(${stockBalancesTable.qty} <> 0 OR ${stockBalancesTable.reservedQty} <> 0 OR ${stockBalancesTable.quarantineQty} <> 0)`))
          .groupBy(stockBalancesTable.warehouseId)
      : [];
    const keepers = ids.length
      ? await db.select({ warehouseId: warehouseKeepersTable.warehouseId, userId: systemUsersTable.id, name: systemUsersTable.fullName }).from(warehouseKeepersTable)
          .innerJoin(systemUsersTable, eq(systemUsersTable.id, warehouseKeepersTable.userId)).where(inArray(warehouseKeepersTable.warehouseId, ids))
      : [];
    const nOf = new Map(counts.map((c) => [c.warehouseId, c.n]));
    res.json({
      kinds,
      canManage: (WAREHOUSE_MANAGE_ROLES as readonly string[]).includes(role),
      items: visible.map((w) => ({
        id: w.id, code: w.code, name: w.name, kind: w.kind, isDefault: w.isDefault, active: w.active, notes: w.notes,
        itemsCount: nOf.get(w.id) ?? 0,
        keepers: keepers.filter((k) => k.warehouseId === w.id).map((k) => ({ userId: k.userId, name: k.name })),
      })),
    });
  } catch (e) {
    send(res, next, e);
  }
});

// GET /api/v1/warehouses/stock?kind=raw&warehouseId=3&mode=combined|separate — أصناف النوع (أو مخزن واحد) بعمود المخزن
router.get("/warehouses/stock", requireAuth, requireRole(...WAREHOUSE_VIEW_ROLES), async (req, res, next) => {
  try {
    const role = req.user!.role;
    const q = z.object({ kind: z.string().optional(), warehouseId: z.coerce.number().int().positive().optional(), mode: z.enum(["combined", "separate"]).default("separate") }).parse(req.query);
    const allowedKinds = kindsFor(role);
    const scope = await scopeOf(role, req.user!.userId);
    let kind: WarehouseKind | undefined;
    let whRows;
    if (q.warehouseId) {
      const [w] = await db.select().from(warehousesTable).where(eq(warehousesTable.id, q.warehouseId));
      if (!w || !isKind(w.kind) || !allowedKinds.includes(w.kind) || !inScope(scope, w.id)) throw fail("المخزن غير موجود أو مش متاح لدورك", 404);
      kind = w.kind;
      whRows = [w];
    } else {
      if (!isKind(q.kind)) throw fail("اختار نوع المخازن", 400);
      if (!allowedKinds.includes(q.kind)) throw fail("نوع المخازن ده مش متاح لدورك", 403);
      kind = q.kind;
      whRows = (await db.select().from(warehousesTable).where(eq(warehousesTable.kind, kind)).orderBy(asc(warehousesTable.id))).filter((w) => inScope(scope, w.id));
    }
    const ids = whRows.map((w) => w.id);
    const rows: StockRow[] = ids.length
      ? (await db.select({
          itemId: inventoryItemsTable.id, itemName: inventoryItemsTable.name, unit: inventoryItemsTable.unit, category: inventoryItemsTable.category, minQty: inventoryItemsTable.minQty,
          warehouseId: warehousesTable.id, warehouseName: warehousesTable.name, qty: stockBalancesTable.qty, reserved: stockBalancesTable.reservedQty, quarantine: stockBalancesTable.quarantineQty,
        }).from(stockBalancesTable)
          .innerJoin(inventoryItemsTable, eq(inventoryItemsTable.id, stockBalancesTable.itemId))
          .innerJoin(warehousesTable, eq(warehousesTable.id, stockBalancesTable.warehouseId))
          .where(and(inArray(stockBalancesTable.warehouseId, ids), sql`(${stockBalancesTable.qty} <> 0 OR ${stockBalancesTable.reservedQty} <> 0 OR ${stockBalancesTable.quarantineQty} <> 0)`))
          .orderBy(asc(inventoryItemsTable.name), asc(warehousesTable.id)))
      : [];
    res.json({
      kind,
      mode: q.mode,
      warehouses: whRows.map((w) => ({ id: w.id, name: w.name, active: w.active })),
      rows: q.mode === "combined" ? combineStock(rows) : rows,
    });
  } catch (e) {
    send(res, next, e);
  }
});

// GET /api/v1/warehouses/storekeepers — أمناء المخازن النشطين (لقايمة التعيين)
router.get("/warehouses/storekeepers", requireAuth, requireRole(...WAREHOUSE_MANAGE_ROLES), async (_req, res, next) => {
  try {
    const rows = await db.select({ id: systemUsersTable.id, name: systemUsersTable.fullName }).from(systemUsersTable)
      .where(and(eq(systemUsersTable.role, "storekeeper"), eq(systemUsersTable.status, "active"))).orderBy(asc(systemUsersTable.fullName));
    res.json(rows);
  } catch (e) {
    send(res, next, e);
  }
});

const createSchema = z.object({ kind: z.enum(["raw", "wip", "finished"]), name: z.string(), notes: z.string().max(300).optional().nullable() });
// POST /api/v1/warehouses — مخزن جديد جوه نوع (الإدارة ومدير المخازن)
router.post("/warehouses", requireAuth, requireRole(...WAREHOUSE_MANAGE_ROLES), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const name = normalizeName(data.name);
    const problem = nameProblem(name);
    if (problem) throw fail(problem, 400);
    const created = await db.transaction(async (tx) => {
      const [w] = await tx.insert(warehousesTable).values({ code: `tmp-${randomUUID()}`, name, kind: data.kind, notes: data.notes?.trim() || null }).returning();
      const [done] = await tx.update(warehousesTable).set({ code: codeFor(data.kind, w!.id) }).where(eq(warehousesTable.id, w!.id)).returning();
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "warehouses.created", resourceType: "warehouse", resourceId: done!.id, beforeData: null, afterData: { code: done!.code, name, kind: data.kind }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      return done!;
    });
    res.status(201).json(created);
  } catch (e) {
    send(res, next, e);
  }
});

const patchSchema = z.object({ name: z.string().optional(), notes: z.string().max(300).optional().nullable(), active: z.boolean().optional() });
// PATCH /api/v1/warehouses/:id — تسمية/ملاحظات/إيقاف (النوع ثابت، والافتراضي مايتوقفش، والمخزن اللي عليه رصيد مايتوقفش)
router.patch("/warehouses/:id", requireAuth, requireRole(...WAREHOUSE_MANAGE_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const data = patchSchema.parse(req.body);
    const set: { name?: string; notes?: string | null; active?: boolean; updatedAt: Date } = { updatedAt: new Date() };
    if (data.name !== undefined) {
      const name = normalizeName(data.name);
      const problem = nameProblem(name);
      if (problem) throw fail(problem, 400);
      set.name = name;
    }
    if (data.notes !== undefined) set.notes = data.notes?.trim() || null;
    if (data.active !== undefined) set.active = data.active;
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(warehousesTable).where(eq(warehousesTable.id, id)).for("update");
      if (!before) throw fail("المخزن غير موجود", 404);
      const [after] = await tx.update(warehousesTable).set(set).where(eq(warehousesTable.id, id)).returning();
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "warehouses.updated", resourceType: "warehouse", resourceId: id, beforeData: { name: before.name, notes: before.notes, active: before.active }, afterData: { name: after!.name, notes: after!.notes, active: after!.active }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
      return after!;
    });
    res.json(updated);
  } catch (e) {
    send(res, next, e);
  }
});

const keepersSchema = z.object({ userIds: z.array(z.number().int().positive()).max(50) });
// PUT /api/v1/warehouses/:id/keepers — تعيين أمناء المخزن (بيستبدل القايمة كلها)
router.put("/warehouses/:id/keepers", requireAuth, requireRole(...WAREHOUSE_MANAGE_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const userIds = [...new Set(keepersSchema.parse(req.body).userIds)];
    await db.transaction(async (tx) => {
      const [w] = await tx.select().from(warehousesTable).where(eq(warehousesTable.id, id)).for("update");
      if (!w) throw fail("المخزن غير موجود", 404);
      if (userIds.length) {
        const ok = await tx.select({ id: systemUsersTable.id }).from(systemUsersTable)
          .where(and(inArray(systemUsersTable.id, userIds), eq(systemUsersTable.role, "storekeeper"), eq(systemUsersTable.status, "active")));
        if (ok.length !== userIds.length) throw fail("لازم كل المعيّنين أمناء مخازن نشطين", 400);
      }
      const before = await tx.select({ userId: warehouseKeepersTable.userId }).from(warehouseKeepersTable).where(eq(warehouseKeepersTable.warehouseId, id));
      await tx.delete(warehouseKeepersTable).where(eq(warehouseKeepersTable.warehouseId, id));
      if (userIds.length) await tx.insert(warehouseKeepersTable).values(userIds.map((userId) => ({ warehouseId: id, userId })));
      await writeAuditEvent({ actorUserId: req.user!.userId, actorName: req.user!.username, actionKey: "warehouses.keepers", resourceType: "warehouse", resourceId: id, beforeData: { userIds: before.map((b) => b.userId) }, afterData: { userIds }, ipAddress: req.ip, userAgent: req.get("user-agent"), executor: tx });
    });
    res.json({ ok: true, userIds });
  } catch (e) {
    send(res, next, e);
  }
});

export default router;
