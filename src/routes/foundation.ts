/** @format */
import { Router, type Request, type Response, type NextFunction } from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  foundationAuditTable,
  foundationItemsTable,
  foundationLocationsTable,
  foundationMachinesTable,
  foundationShiftsTable,
  foundationTransitionsTable,
  foundationUnitConversionsTable,
  foundationWorkCentersTable,
  foundationItemSchema,
  foundationConversionSchema,
  foundationLocationSchema,
  foundationMachineSchema,
  foundationShiftSchema,
  foundationTransitionSchema,
  foundationWorkCenterSchema,
  phase0NumberSequencesTable,
  phase0NumberSequenceSchema,
  phase0TransitionCheckSchema,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { assertPhase0Transition } from "../lib/phase0";

const router = Router();
const FOUNDATION_ROLES = [
  "chairman",
  "executive_manager",
  "operations_manager",
  "warehouse_manager",
  "production_manager",
] as const;

function actor(req: Request) {
  return {
    actorId: req.user?.userId ? String(req.user.userId) : "system",
    actorRole: req.user?.role ?? "system",
  };
}

async function recordAudit(
  req: Request,
  entityType: string,
  entityId: number | null,
  action: string,
  afterData: unknown,
  beforeData: unknown = null,
  reason: string | null = null,
) {
  const user = actor(req);
  await db.insert(foundationAuditTable).values({
    entityType,
    entityId,
    action,
    actorId: user.actorId,
    actorRole: user.actorRole,
    reason,
    beforeData,
    afterData,
  });
}

function duplicateError(err: unknown) {
  return err instanceof Error && "code" in err && (err as { code?: string }).code === "23505";
}

function forward(err: unknown, next: NextFunction) {
  if (duplicateError(err)) {
    next(Object.assign(new Error("الكود موجود بالفعل"), { status: 409 }));
  } else {
    next(err);
  }
}

router.use("/foundation", requireAuth);

router.get("/foundation/summary", requireRole(...FOUNDATION_ROLES), async (_req, res, next) => {
  try {
    const count = (table: any, activeColumn: any) =>
      db.select({ count: sql<number>`count(*)` }).from(table).where(eq(activeColumn, true));
    const [items, locations, workCenters, machines, shifts, transitions] = await Promise.all([
      count(foundationItemsTable, foundationItemsTable.active),
      count(foundationLocationsTable, foundationLocationsTable.active),
      count(foundationWorkCentersTable, foundationWorkCentersTable.active),
      count(foundationMachinesTable, foundationMachinesTable.active),
      count(foundationShiftsTable, foundationShiftsTable.active),
      count(foundationTransitionsTable, foundationTransitionsTable.active),
    ]);
    res.json({
      items: Number(items[0]?.count ?? 0),
      locations: Number(locations[0]?.count ?? 0),
      workCenters: Number(workCenters[0]?.count ?? 0),
      machines: Number(machines[0]?.count ?? 0),
      shifts: Number(shifts[0]?.count ?? 0),
      transitions: Number(transitions[0]?.count ?? 0),
    });
  } catch (err) { next(err); }
});

router.get("/foundation/items", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const rows = await db.select().from(foundationItemsTable)
      .where(search ? or(
        ilike(foundationItemsTable.name, `%${search}%`),
        ilike(foundationItemsTable.code, `%${search}%`),
      ) : undefined)
      .orderBy(asc(foundationItemsTable.code));
    res.json(rows);
  } catch (err) { next(err); }
});

router.post("/foundation/items", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const data = foundationItemSchema.parse(req.body);
    const [created] = await db.insert(foundationItemsTable).values(data).returning();
    await recordAudit(req, "item", created.id, "created", created);
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/items/:id", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [before] = await db.select().from(foundationItemsTable).where(eq(foundationItemsTable.id, id));
    if (!before) { res.status(404).json({ error: { message: "الصنف غير موجود" } }); return; }
    const data = foundationItemSchema.partial().parse(req.body);
    const [updated] = await db.update(foundationItemsTable).set({ ...data, updatedAt: new Date() })
      .where(eq(foundationItemsTable.id, id)).returning();
    await recordAudit(req, "item", id, "updated", updated, before);
    res.json(updated);
  } catch (err) { forward(err, next); }
});

router.get("/foundation/items/:id/conversions", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    res.json(await db.select().from(foundationUnitConversionsTable)
      .where(eq(foundationUnitConversionsTable.itemId, id)).orderBy(asc(foundationUnitConversionsTable.fromUnit)));
  } catch (err) { next(err); }
});

router.post("/foundation/items/:id/conversions", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const itemId = parseIdParam(req.params.id, res);
    if (itemId === null) return;
    const data = foundationConversionSchema.parse({ ...req.body, itemId });
    const [item] = await db.select({ id: foundationItemsTable.id }).from(foundationItemsTable)
      .where(eq(foundationItemsTable.id, itemId));
    if (!item) { res.status(404).json({ error: { message: "الصنف غير موجود" } }); return; }
    const [created] = await db.insert(foundationUnitConversionsTable).values(data).returning();
    await recordAudit(req, "unit_conversion", created.id, "created", created);
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.get("/foundation/locations", requireRole(...FOUNDATION_ROLES), async (_req, res, next) => {
  try { res.json(await db.select().from(foundationLocationsTable).orderBy(asc(foundationLocationsTable.code))); }
  catch (err) { next(err); }
});

router.post("/foundation/locations", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const data = foundationLocationSchema.parse(req.body);
    if (data.parentId) {
      const [parent] = await db.select({ id: foundationLocationsTable.id }).from(foundationLocationsTable)
        .where(eq(foundationLocationsTable.id, data.parentId));
      if (!parent) { res.status(422).json({ error: { message: "الموقع الأب غير موجود" } }); return; }
    }
    const [created] = await db.insert(foundationLocationsTable).values(data).returning();
    await recordAudit(req, "location", created.id, "created", created);
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/locations/:id", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [before] = await db.select().from(foundationLocationsTable).where(eq(foundationLocationsTable.id, id));
    if (!before) { res.status(404).json({ error: { message: "الموقع غير موجود" } }); return; }
    const data = foundationLocationSchema.partial().parse(req.body);
    if (data.parentId === id) { res.status(422).json({ error: { message: "الموقع لا يمكن أن يكون أبًا لنفسه" } }); return; }
    if (data.parentId) {
      let ancestorId: number | null = data.parentId;
      const visited = new Set<number>([id]);
      while (ancestorId !== null) {
        if (visited.has(ancestorId)) {
          res.status(422).json({ error: { message: "لا يمكن إنشاء دورة في شجرة المواقع" } });
          return;
        }
        visited.add(ancestorId);
        const [ancestor] = await db.select({ parentId: foundationLocationsTable.parentId })
          .from(foundationLocationsTable)
          .where(eq(foundationLocationsTable.id, ancestorId));
        if (!ancestor) {
          res.status(422).json({ error: { message: "الموقع الأب غير موجود" } });
          return;
        }
        ancestorId = ancestor.parentId;
      }
    }
    const [updated] = await db.update(foundationLocationsTable).set({ ...data, updatedAt: new Date() })
      .where(eq(foundationLocationsTable.id, id)).returning();
    await recordAudit(req, "location", id, "updated", updated, before);
    res.json(updated);
  } catch (err) { forward(err, next); }
});

router.get("/foundation/work-centers", requireRole(...FOUNDATION_ROLES), async (_req, res, next) => {
  try { res.json(await db.select().from(foundationWorkCentersTable).orderBy(asc(foundationWorkCentersTable.code))); }
  catch (err) { next(err); }
});

router.post("/foundation/work-centers", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const data = foundationWorkCenterSchema.parse(req.body);
    if (data.locationId) {
      const [location] = await db.select({ id: foundationLocationsTable.id }).from(foundationLocationsTable)
        .where(eq(foundationLocationsTable.id, data.locationId));
      if (!location) { res.status(422).json({ error: { message: "الموقع غير موجود" } }); return; }
    }
    const [created] = await db.insert(foundationWorkCentersTable).values(data).returning();
    await recordAudit(req, "work_center", created.id, "created", created);
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/work-centers/:id", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [before] = await db.select().from(foundationWorkCentersTable).where(eq(foundationWorkCentersTable.id, id));
    if (!before) { res.status(404).json({ error: { message: "مركز العمل غير موجود" } }); return; }
    const data = foundationWorkCenterSchema.partial().parse(req.body);
    if (data.locationId) {
      const [location] = await db.select({ id: foundationLocationsTable.id }).from(foundationLocationsTable)
        .where(eq(foundationLocationsTable.id, data.locationId));
      if (!location) { res.status(422).json({ error: { message: "الموقع غير موجود" } }); return; }
    }
    const [updated] = await db.update(foundationWorkCentersTable).set({ ...data, updatedAt: new Date() })
      .where(eq(foundationWorkCentersTable.id, id)).returning();
    await recordAudit(req, "work_center", id, "updated", updated, before);
    res.json(updated);
  } catch (err) { forward(err, next); }
});

router.get("/foundation/machines", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const center = typeof req.query.workCenterId === "string" ? parseIdParam(req.query.workCenterId, res) : null;
    if (typeof req.query.workCenterId === "string" && center === null) return;
    res.json(await db.select().from(foundationMachinesTable)
      .where(center ? eq(foundationMachinesTable.workCenterId, center) : undefined)
      .orderBy(asc(foundationMachinesTable.code)));
  } catch (err) { next(err); }
});

router.post("/foundation/machines", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const data = foundationMachineSchema.parse(req.body);
    const [center] = await db.select({ id: foundationWorkCentersTable.id }).from(foundationWorkCentersTable)
      .where(eq(foundationWorkCentersTable.id, data.workCenterId));
    if (!center) { res.status(422).json({ error: { message: "مركز العمل غير موجود" } }); return; }
    const [created] = await db.insert(foundationMachinesTable).values(data).returning();
    await recordAudit(req, "machine", created.id, "created", created);
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/machines/:id", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [before] = await db.select().from(foundationMachinesTable).where(eq(foundationMachinesTable.id, id));
    if (!before) { res.status(404).json({ error: { message: "الماكينة غير موجودة" } }); return; }
    const data = foundationMachineSchema.partial().parse(req.body);
    if (data.workCenterId) {
      const [center] = await db.select({ id: foundationWorkCentersTable.id }).from(foundationWorkCentersTable)
        .where(eq(foundationWorkCentersTable.id, data.workCenterId));
      if (!center) { res.status(422).json({ error: { message: "مركز العمل غير موجود" } }); return; }
    }
    const [updated] = await db.update(foundationMachinesTable).set({ ...data, updatedAt: new Date() })
      .where(eq(foundationMachinesTable.id, id)).returning();
    await recordAudit(req, "machine", id, "updated", updated, before);
    res.json(updated);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/machines/:id/status", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const status = foundationMachineSchema.shape.status.parse(req.body.status);
    const [before] = await db.select().from(foundationMachinesTable).where(eq(foundationMachinesTable.id, id));
    if (!before) { res.status(404).json({ error: { message: "الماكينة غير موجودة" } }); return; }
    const [updated] = await db.update(foundationMachinesTable).set({ status, updatedAt: new Date() })
      .where(eq(foundationMachinesTable.id, id)).returning();
    await recordAudit(req, "machine", id, "status_changed", updated, before, req.body.reason ?? null);
    res.json(updated);
  } catch (err) { forward(err, next); }
});

router.get("/foundation/shifts", requireRole(...FOUNDATION_ROLES), async (_req, res, next) => {
  try { res.json(await db.select().from(foundationShiftsTable).orderBy(asc(foundationShiftsTable.code))); }
  catch (err) { next(err); }
});

router.post("/foundation/shifts", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const data = foundationShiftSchema.parse(req.body);
    const [created] = await db.insert(foundationShiftsTable).values(data).returning();
    await recordAudit(req, "shift", created.id, "created", created);
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/shifts/:id", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [before] = await db.select().from(foundationShiftsTable).where(eq(foundationShiftsTable.id, id));
    if (!before) { res.status(404).json({ error: { message: "الوردية غير موجودة" } }); return; }
    const data = foundationShiftSchema.partial().parse(req.body);
    const [updated] = await db.update(foundationShiftsTable).set({ ...data, updatedAt: new Date() })
      .where(eq(foundationShiftsTable.id, id)).returning();
    await recordAudit(req, "shift", id, "updated", updated, before);
    res.json(updated);
  } catch (err) { forward(err, next); }
});

router.get("/foundation/transitions", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
    res.json(await db.select().from(foundationTransitionsTable)
      .where(entityType ? eq(foundationTransitionsTable.entityType, entityType) : undefined)
      .orderBy(asc(foundationTransitionsTable.entityType), asc(foundationTransitionsTable.fromState)));
  } catch (err) { next(err); }
});

router.post("/foundation/transitions", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const data = foundationTransitionSchema.parse(req.body);
    if (data.fromState === data.toState) { res.status(422).json({ error: { message: "حالة البداية والنهاية يجب أن تختلفا" } }); return; }
    const [created] = await db.insert(foundationTransitionsTable).values(data).returning();
    await recordAudit(req, "state_transition", created.id, "created", created);
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.get("/foundation/audit", requireRole("chairman"), async (req, res, next) => {
  try {
    const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    res.json(await db.select().from(foundationAuditTable)
      .where(entityType ? eq(foundationAuditTable.entityType, entityType) : undefined)
      .orderBy(desc(foundationAuditTable.createdAt)).limit(limit));
  } catch (err) { next(err); }
});

router.get("/foundation/number-sequences", requireRole(...FOUNDATION_ROLES), async (_req, res, next) => {
  try {
    res.json(await db.select().from(phase0NumberSequencesTable).orderBy(asc(phase0NumberSequencesTable.sequenceKey)));
  } catch (err) { next(err); }
});

router.post("/foundation/number-sequences", requireRole("chairman"), async (req, res, next) => {
  try {
    const data = phase0NumberSequenceSchema.parse(req.body);
    const [created] = await db.insert(phase0NumberSequencesTable).values(data).returning();
    await recordAudit(req, "number_sequence", created.id, "created", created);
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/number-sequences/:id", requireRole("chairman"), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const data = phase0NumberSequenceSchema.partial().parse(req.body);
    const [before] = await db.select().from(phase0NumberSequencesTable)
      .where(eq(phase0NumberSequencesTable.id, id));
    if (!before) { res.status(404).json({ error: { message: "عداد الترقيم غير موجود" } }); return; }
    const [updated] = await db.update(phase0NumberSequencesTable).set({ ...data, updatedAt: new Date() })
      .where(eq(phase0NumberSequencesTable.id, id)).returning();
    await recordAudit(req, "number_sequence", id, "updated", updated, before);
    res.json(updated);
  } catch (err) { forward(err, next); }
});

router.get("/foundation/number-sequences/:key/preview", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const [sequence] = await db.select().from(phase0NumberSequencesTable)
      .where(and(eq(phase0NumberSequencesTable.sequenceKey, key), eq(phase0NumberSequencesTable.active, true)));
    if (!sequence) { res.status(404).json({ error: { message: "عداد الترقيم غير موجود" } }); return; }
    const preview = `${sequence.prefix}${String(sequence.nextValue).padStart(sequence.padding, "0")}`;
    res.json({ key, preview, consumed: false });
  } catch (err) { forward(err, next); }
});

router.post("/foundation/validate-transition", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const data = phase0TransitionCheckSchema.parse(req.body);
    const transition = await db.transaction(async (tx) => assertPhase0Transition(tx, {
      ...data,
      role: req.user!.role,
      reason: req.body.reason,
    }));
    res.json({ allowed: true, transition });
  } catch (err) { forward(err, next); }
});

export default router;