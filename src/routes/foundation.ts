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
  foundationItemVersionsTable,
  foundationItemAliasesTable,
  foundationItemSchema,
  foundationConversionSchema,
  foundationLocationSchema,
  foundationMachineSchema,
  foundationShiftSchema,
  foundationTransitionSchema,
  foundationWorkCenterSchema,
  createFoundationItemAliasSchema,
  requestFoundationItemChangeSchema,
  decideFoundationItemChangeSchema,
  phase0NumberSequencesTable,
  phase0NumberSequenceSchema,
  phase0TransitionCheckSchema,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";
import { assertPhase0Transition } from "../lib/phase0";
import { assertInactivationAllowed } from "../domain/foundation-inactivation";
import {
  isCriticalFoundationItemChange,
  assertAllowedFoundationItemTransition,
  preValidateImportRow,
  summarizeImportRows,
  type ImportRow,
} from "../domain/foundation-governance";
import {
  recordFoundationItemVersion,
  listFoundationItemHistory,
  listFoundationItemAliases,
  findDuplicateFoundationItemGroups,
  findDuplicateFoundationItemCodeGroups,
} from "../lib/foundation-governance";
import {
  checkItemInactivationImpact,
  checkLocationInactivationImpact,
  checkWorkCenterInactivationImpact,
} from "../lib/foundation-inactivation";

const router = Router();
const FOUNDATION_ROLES = [
  "chairman",
  "executive_manager",
  "operations_manager",
  "warehouse_manager",
  "production_manager",
] as const;
// Phase 03 (delivery 3): who may approve/reject a pending governed-item
// change. Narrower than FOUNDATION_ROLES on purpose — an approval step
// that any editor can also approve is not a review.
const APPROVAL_ROLES = [
  "chairman",
  "executive_manager",
  "operations_manager",
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

// Phase 03 (delivery 1): overrideReason is intentionally read directly from
// req.body rather than added to foundationItemSchema/foundationLocationSchema
// /foundationWorkCenterSchema, because those schemas are also the shape of
// the persisted row (used with .partial() for PATCH); overrideReason is a
// request-only instruction, never a column, and must never be spread into
// db.update(...).set({ ...data }).
function readOverrideReason(req: Request): string | null {
  const value = (req.body as Record<string, unknown> | undefined)
    ?.overrideReason;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
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

// Phase 1 (Governance & Portal project) audit finding: "hr"/"hr_manager" can
// create/edit BOM recipes (see PERMISSIONS.bom.write in src/lib/permissions.ts)
// and now need to pick a Foundation "finished_good" item when linking a
// recipe, but were not in FOUNDATION_ROLES and so could never call this
// read-only list endpoint at all. Added them here, read-only, without
// touching any of the write endpoints below (still FOUNDATION_ROLES only).
router.get(
  "/foundation/items",
  requireRole(...FOUNDATION_ROLES, "hr", "hr_manager"),
  async (req, res, next) => {
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
    // Phase 03 (delivery 3): baseUnit/itemType/minStock are "critical" —
    // once an item is live (status "active"), they must go through
    // request-change -> approve/reject rather than a direct PATCH. A draft
    // item has not affected live operations yet, so it can still be edited
    // freely here. This mirrors the USE_DEDICATED_CANCEL_ENDPOINT pattern
    // from phase 02 delivery 3: refuse before any write, point at the
    // correct endpoint, rather than silently applying a critical change.
    if (before.status === "active" && isCriticalFoundationItemChange(data as Record<string, unknown>)) {
      throw Object.assign(
        new Error(
          "تغيير حقل حرج (وحدة القياس/نوع الصنف/الحد الأدنى) على صنف نشط يتطلب طلب تغيير واعتماد — استخدم POST /foundation/items/:id/request-change",
        ),
        { status: 409, code: "USE_REQUEST_CHANGE_ENDPOINT" },
      );
    }
    // Phase 02 (delivery 1): "Inactivation cannot silently break open work."
    // Only the true -> false edge is checked; re-saving an already-inactive
    // item, or activating one, never needs the impact query.
    if (before.active && data.active === false) {
      const overrideReason = readOverrideReason(req);
      const impact = await checkItemInactivationImpact(db, id);
      assertInactivationAllowed(impact, overrideReason);
    }
    const overrideReason = readOverrideReason(req);
    const nextStatus =
      data.active === false ? "retired" : data.active === true ? "active" : before.status;
    const updated = await db.transaction(async (tx) => {
      await recordFoundationItemVersion(tx, before, actor(req).actorId, req.user?.username ?? null, overrideReason);
      const [row] = await tx
        .update(foundationItemsTable)
        .set({ ...data, status: nextStatus, version: before.version + 1, updatedAt: new Date() })
        .where(eq(foundationItemsTable.id, id))
        .returning();
      return row;
    });
    await recordAudit(req, "item", id, "updated", updated, before, overrideReason);
    res.json(updated);
  } catch (err) { forward(err, next); }
});

router.get("/foundation/items/:id/history", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    res.json(await listFoundationItemHistory(db, id));
  } catch (err) { next(err); }
});

router.get("/foundation/items/:id/impact", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  // Phase 03 (delivery 3): read-only "what will break if I deactivate this?"
  // preview, reusing the exact same impact query the PATCH handler above
  // runs before a real deactivation — so the preview can never disagree
  // with what actually happens next.
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    res.json(await checkItemInactivationImpact(db, id));
  } catch (err) { next(err); }
});

router.get("/foundation/items/duplicates", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const [byName, byCode] = await Promise.all([
      findDuplicateFoundationItemGroups(db, 50),
      findDuplicateFoundationItemCodeGroups(db, 50),
    ]);
    res.json({ byName, byCode });
  } catch (err) { next(err); }
});

router.get("/foundation/items/:id/aliases", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    res.json(await listFoundationItemAliases(db, id));
  } catch (err) { next(err); }
});

router.post("/foundation/items/:id/aliases", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [item] = await db.select({ id: foundationItemsTable.id }).from(foundationItemsTable).where(eq(foundationItemsTable.id, id));
    if (!item) { res.status(404).json({ error: { message: "الصنف غير موجود" } }); return; }
    const data = createFoundationItemAliasSchema.parse(req.body);
    const user = actor(req);
    const [alias] = await db.insert(foundationItemAliasesTable).values({
      itemId: id, alias: data.alias, createdById: user.actorId, createdByName: req.user?.username ?? null,
    }).returning();
    await recordAudit(req, "item_alias", alias.id, "created", alias, null, null);
    res.status(201).json(alias);
  } catch (err) { forward(err, next); }
});

router.delete("/foundation/items/:id/aliases/:aliasId", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    const aliasId = parseIdParam(req.params.aliasId, res);
    if (id === null || aliasId === null) return;
    const [deleted] = await db.delete(foundationItemAliasesTable)
      .where(and(eq(foundationItemAliasesTable.id, aliasId), eq(foundationItemAliasesTable.itemId, id)))
      .returning();
    if (!deleted) { res.status(404).json({ error: { message: "الاسم البديل غير موجود" } }); return; }
    await recordAudit(req, "item_alias", aliasId, "deleted", null, deleted, null);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// Phase 03 (delivery 3): approval workflow for critical changes on a live
// item. request-change never touches the live field values — it only
// stores the proposal and moves status active -> pending_approval, so a
// rejected proposal leaves the item exactly as it was.
router.post("/foundation/items/:id/request-change", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [before] = await db.select().from(foundationItemsTable).where(eq(foundationItemsTable.id, id));
    if (!before) { res.status(404).json({ error: { message: "الصنف غير موجود" } }); return; }
    assertAllowedFoundationItemTransition(before.status, "pending_approval");
    const input = requestFoundationItemChangeSchema.parse(req.body);
    const user = actor(req);
    const [updated] = await db.update(foundationItemsTable).set({
      status: "pending_approval",
      pendingChangePayload: input.changes,
      pendingChangeReason: input.reason,
      pendingChangeRequestedById: user.actorId,
      pendingChangeRequestedByName: req.user?.username ?? null,
      pendingChangeRequestedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(foundationItemsTable.id, id)).returning();
    await recordAudit(req, "item", id, "change_requested", updated, before, input.reason);
    res.json(updated);
  } catch (err) { forward(err, next); }
});

router.post("/foundation/items/:id/approve", requireRole(...APPROVAL_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [before] = await db.select().from(foundationItemsTable).where(eq(foundationItemsTable.id, id));
    if (!before) { res.status(404).json({ error: { message: "الصنف غير موجود" } }); return; }
    if (before.status !== "pending_approval" || !before.pendingChangePayload) {
      throw Object.assign(new Error("لا يوجد تغيير معلّق لهذا الصنف"), { status: 409, code: "NO_PENDING_CHANGE" });
    }
    assertAllowedFoundationItemTransition(before.status, "active");
    const decision = decideFoundationItemChangeSchema.parse(req.body ?? {});
    const user = actor(req);
    const updated = await db.transaction(async (tx) => {
      await recordFoundationItemVersion(tx, before, before.pendingChangeRequestedById, before.pendingChangeRequestedByName, before.pendingChangeReason);
      const [row] = await tx.update(foundationItemsTable).set({
        ...(before.pendingChangePayload as Record<string, unknown>),
        status: "active",
        version: before.version + 1,
        pendingChangePayload: null,
        pendingChangeReason: null,
        pendingChangeRequestedById: null,
        pendingChangeRequestedByName: null,
        pendingChangeRequestedAt: null,
        updatedAt: new Date(),
      }).where(eq(foundationItemsTable.id, id)).returning();
      return row;
    });
    await recordAudit(req, "item", id, "change_approved", updated, before, decision.reason ?? null);
    res.json(updated);
  } catch (err) { forward(err, next); }
});

router.post("/foundation/items/:id/reject", requireRole(...APPROVAL_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [before] = await db.select().from(foundationItemsTable).where(eq(foundationItemsTable.id, id));
    if (!before) { res.status(404).json({ error: { message: "الصنف غير موجود" } }); return; }
    if (before.status !== "pending_approval") {
      throw Object.assign(new Error("لا يوجد تغيير معلّق لهذا الصنف"), { status: 409, code: "NO_PENDING_CHANGE" });
    }
    assertAllowedFoundationItemTransition(before.status, "active");
    const decision = decideFoundationItemChangeSchema.parse(req.body ?? {});
    const [updated] = await db.update(foundationItemsTable).set({
      status: "active",
      pendingChangePayload: null,
      pendingChangeReason: null,
      pendingChangeRequestedById: null,
      pendingChangeRequestedByName: null,
      pendingChangeRequestedAt: null,
      updatedAt: new Date(),
    }).where(eq(foundationItemsTable.id, id)).returning();
    await recordAudit(req, "item", id, "change_rejected", updated, before, decision.reason ?? null);
    res.json(updated);
  } catch (err) { forward(err, next); }
});

// Phase 03 (delivery 3): bounded, all-or-nothing import. dryRun (default
// true) never touches the database — it only returns row-level validation
// results, matching "never partially apply a batch with any bad row."
// Capped at 500 rows per call so one request cannot hold a transaction
// open indefinitely or block the connection pool.
const MAX_IMPORT_ROWS = 500;
router.post("/foundation/items/import", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const body = req.body as { rows?: unknown; dryRun?: unknown };
    const rows = Array.isArray(body.rows) ? (body.rows as ImportRow[]) : null;
    if (!rows || rows.length === 0) { res.status(400).json({ error: { message: "rows مطلوب كمصفوفة غير فارغة" } }); return; }
    if (rows.length > MAX_IMPORT_ROWS) {
      res.status(413).json({ error: { message: `الحد الأقصى ${MAX_IMPORT_ROWS} صف لكل استيراد` } });
      return;
    }
    const dryRun = body.dryRun !== false;
    const preChecked = rows.map((row, i) => preValidateImportRow(row, i));
    const summary = summarizeImportRows(preChecked);
    if (dryRun || !summary.canApply) {
      res.json({ ...summary, dryRun: true, results: preChecked });
      return;
    }
    // Re-parse every row through the real schema (defaults, enum checks,
    // etc.) now that the cheap pre-check says every row is well-formed
    // enough to attempt; a schema failure here still aborts the whole
    // batch before any write, inside the same request.
    const parsedRows = rows.map((row) => foundationItemSchema.parse(row));
    const user = actor(req);
    const applied = await db.transaction(async (tx) => {
      const results: Array<{ code: string; action: "created" | "updated" }> = [];
      for (const parsed of parsedRows) {
        const [existing] = await tx.select().from(foundationItemsTable)
          .where(sql`lower(${foundationItemsTable.code}) = lower(${parsed.code})`);
        if (existing) {
          await recordFoundationItemVersion(tx, existing, user.actorId, req.user?.username ?? null, "استيراد دفعي");
          await tx.update(foundationItemsTable).set({
            ...parsed, version: existing.version + 1, updatedAt: new Date(),
          }).where(eq(foundationItemsTable.id, existing.id));
          results.push({ code: parsed.code, action: "updated" });
        } else {
          await tx.insert(foundationItemsTable).values({ ...parsed, status: "draft", active: false });
          results.push({ code: parsed.code, action: "created" });
        }
      }
      return results;
    });
    await recordAudit(req, "item", null, "imported", { count: applied.length }, null, `استيراد دفعي: ${applied.length} صف`);
    res.json({ ...summary, dryRun: false, applied });
  } catch (err) { forward(err, next); }
});

router.get("/foundation/items/export", requireRole(...FOUNDATION_ROLES), async (_req, res, next) => {
  try {
    res.json(await db.select().from(foundationItemsTable).orderBy(asc(foundationItemsTable.code)));
  } catch (err) { next(err); }
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
    if (before.active && data.active === false) {
      const overrideReason = readOverrideReason(req);
      const impact = await checkLocationInactivationImpact(db, id);
      assertInactivationAllowed(impact, overrideReason);
    }
    const [updated] = await db.update(foundationLocationsTable).set({ ...data, updatedAt: new Date() })
      .where(eq(foundationLocationsTable.id, id)).returning();
    await recordAudit(req, "location", id, "updated", updated, before, readOverrideReason(req));
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
    if (before.active && data.active === false) {
      const overrideReason = readOverrideReason(req);
      const impact = await checkWorkCenterInactivationImpact(db, id);
      assertInactivationAllowed(impact, overrideReason);
    }
    const [updated] = await db.update(foundationWorkCentersTable).set({ ...data, updatedAt: new Date() })
      .where(eq(foundationWorkCentersTable.id, id)).returning();
    await recordAudit(req, "work_center", id, "updated", updated, before, readOverrideReason(req));
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