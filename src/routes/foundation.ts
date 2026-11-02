/** @format */
import { Router, type Request, type Response, type NextFunction } from "express";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
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
  CRITICAL_FOUNDATION_ITEM_FIELDS,
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
  type ImportRowResult,
} from "../domain/foundation-governance";
import {
  recordFoundationItemVersion,
  listFoundationItemHistory,
  listFoundationItemAliases,
  findDuplicateFoundationItemGroups,
  findDuplicateFoundationItemCodeGroups,
} from "../lib/foundation-governance";
import { checkItemInactivationImpact } from "../lib/foundation-inactivation";
import { foundationImpact, hasBlockers, IMPACT_KINDS, type ImpactKind } from "../lib/foundation-impact";

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
  executor: Pick<typeof db, "insert"> = db,
) {
  const user = actor(req);
  await executor.insert(foundationAuditTable).values({
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
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(foundationItemsTable).values(data).returning();
      await recordAudit(req, "item", row.id, "created", row, null, null, tx);
      return row;
    });
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/items/:id", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const data = foundationItemSchema.partial().parse(req.body);
    const overrideReason = readOverrideReason(req);
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(foundationItemsTable).where(eq(foundationItemsTable.id, id)).for("update");
      if (!before) throw fail(404, "الصنف غير موجود");
      // Phase 03 (delivery 3): baseUnit/itemType/minStock حقول حرجة؛ على صنف نشط لازم طلب تغيير واعتماد، مش تعديل مباشر.
      if (before.status === "active" && isCriticalFoundationItemChange(data as Record<string, unknown>)) {
        throw Object.assign(
          new Error("تغيير حقل حرج (وحدة القياس/نوع الصنف/الحد الأدنى) على صنف نشط يتطلب طلب تغيير واعتماد"),
          { status: 409, code: "USE_REQUEST_CHANGE_ENDPOINT" },
        );
      }
      // الإيقاف (true -> false) بيعدّي على فحص الأثر؛ التفعيل أو إعادة حفظ موقوف لأ.
      if (before.active && data.active === false) {
        assertInactivationAllowed(await checkItemInactivationImpact(tx, id), overrideReason);
      }
      const nextStatus = data.active === false ? "retired" : data.active === true ? "active" : before.status;
      await recordFoundationItemVersion(tx, before, actor(req).actorId, req.user?.username ?? null, overrideReason);
      const [row] = await tx.update(foundationItemsTable)
        .set({ ...data, status: nextStatus, version: before.version + 1, updatedAt: new Date() })
        .where(eq(foundationItemsTable.id, id)).returning();
      await recordAudit(req, "item", id, "updated", row, before, overrideReason, tx);
      return row;
    });
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
    const data = createFoundationItemAliasSchema.parse(req.body);
    const user = actor(req);
    const alias = await db.transaction(async (tx) => {
      const [item] = await tx.select({ id: foundationItemsTable.id }).from(foundationItemsTable).where(eq(foundationItemsTable.id, id));
      if (!item) throw fail(404, "الصنف غير موجود");
      const [row] = await tx.insert(foundationItemAliasesTable).values({
        itemId: id, alias: data.alias, createdById: user.actorId, createdByName: req.user?.username ?? null,
      }).returning();
      await recordAudit(req, "item_alias", row.id, "created", row, null, null, tx);
      return row;
    });
    res.status(201).json(alias);
  } catch (err) { forward(err, next); }
});

router.delete("/foundation/items/:id/aliases/:aliasId", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    const aliasId = parseIdParam(req.params.aliasId, res);
    if (id === null || aliasId === null) return;
    await db.transaction(async (tx) => {
      const [deleted] = await tx.delete(foundationItemAliasesTable)
        .where(and(eq(foundationItemAliasesTable.id, aliasId), eq(foundationItemAliasesTable.itemId, id)))
        .returning();
      if (!deleted) throw fail(404, "الاسم البديل غير موجود");
      await recordAudit(req, "item_alias", aliasId, "deleted", null, deleted, null, tx);
    });
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
    const input = requestFoundationItemChangeSchema.parse(req.body);
    // الاعتماد بيكتب الـpayload ده في الصنف زي ما هو، فنفحصه بنفس مخطط الصنف (نوع صالح، رقم صحيح...) قبل ما يتخزّن.
    const checked = foundationItemSchema.partial().omit({ active: true }).parse(input.changes);
    const changes = { ...input.changes, ...checked };
    const user = actor(req);
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(foundationItemsTable).where(eq(foundationItemsTable.id, id)).for("update");
      if (!before) throw fail(404, "الصنف غير موجود");
      assertAllowedFoundationItemTransition(before.status, "pending_approval");
      const [row] = await tx.update(foundationItemsTable).set({
        status: "pending_approval",
        pendingChangePayload: changes,
        pendingChangeReason: input.reason,
        pendingChangeRequestedById: user.actorId,
        pendingChangeRequestedByName: req.user?.username ?? null,
        pendingChangeRequestedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(foundationItemsTable.id, id)).returning();
      await recordAudit(req, "item", id, "change_requested", row, before, input.reason, tx);
      return row;
    });
    res.json(updated);
  } catch (err) { forward(err, next); }
});

router.post("/foundation/items/:id/approve", requireRole(...APPROVAL_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const decision = decideFoundationItemChangeSchema.parse(req.body ?? {});
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(foundationItemsTable).where(eq(foundationItemsTable.id, id)).for("update");
      if (!before) throw fail(404, "الصنف غير موجود");
      if (before.status !== "pending_approval" || !before.pendingChangePayload) {
        throw Object.assign(new Error("لا يوجد تغيير معلّق لهذا الصنف"), { status: 409, code: "NO_PENDING_CHANGE" });
      }
      assertAllowedFoundationItemTransition(before.status, "active");
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
      await recordAudit(req, "item", id, "change_approved", row, before, decision.reason ?? null, tx);
      return row;
    });
    res.json(updated);
  } catch (err) { forward(err, next); }
});

router.post("/foundation/items/:id/reject", requireRole(...APPROVAL_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const decision = decideFoundationItemChangeSchema.parse(req.body ?? {});
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(foundationItemsTable).where(eq(foundationItemsTable.id, id)).for("update");
      if (!before) throw fail(404, "الصنف غير موجود");
      if (before.status !== "pending_approval") {
        throw Object.assign(new Error("لا يوجد تغيير معلّق لهذا الصنف"), { status: 409, code: "NO_PENDING_CHANGE" });
      }
      assertAllowedFoundationItemTransition(before.status, "active");
      const [row] = await tx.update(foundationItemsTable).set({
        status: "active",
        pendingChangePayload: null,
        pendingChangeReason: null,
        pendingChangeRequestedById: null,
        pendingChangeRequestedByName: null,
        pendingChangeRequestedAt: null,
        updatedAt: new Date(),
      }).where(eq(foundationItemsTable.id, id)).returning();
      await recordAudit(req, "item", id, "change_rejected", row, before, decision.reason ?? null, tx);
      return row;
    });
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
    const preChecked: ImportRowResult[] = rows.map((row, i) => preValidateImportRow(row, i));
    // صنف نشط موجود بالكود: الاستيراد مينفعش يغيّر حقل حرج فيه (وحدة/نوع/حد أدنى) من غير اعتماد، فنرفض الصف من المعاينة.
    const codes = [...new Set(rows.map((r) => (typeof r.code === "string" ? r.code.trim().toLowerCase() : "")).filter(Boolean))];
    const existingRows = codes.length ? await db.select().from(foundationItemsTable).where(inArray(sql`lower(${foundationItemsTable.code})`, codes)) : [];
    const existingByCode = new Map(existingRows.map((r) => [r.code.toLowerCase(), r]));
    const checked: ImportRowResult[] = preChecked.map((result, i) => {
      if (!result.ok) return result;
      const existing = existingByCode.get(result.code.toLowerCase());
      const row = rows[i] as ImportRow;
      if (existing && existing.status === "active" && isCriticalFoundationItemChange(Object.fromEntries(CRITICAL_FOUNDATION_ITEM_FIELDS.filter((f) => row[f] !== undefined && String(row[f]) !== String(existing[f])).map((f) => [f, row[f]])))) {
        return { row: result.row, ok: false as const, errors: ["الصنف نشط وتغيير الوحدة/النوع/الحد الأدنى يحتاج طلب تغيير واعتماد (مش استيراد)"] };
      }
      return result;
    });
    const summary = summarizeImportRows(checked);
    if (dryRun || !summary.canApply) {
      res.json({ ...summary, dryRun: true, results: checked });
      return;
    }
    // كل صف يعدّي على المخطط الحقيقي (قيم افتراضية، enum...) قبل أي كتابة، والباتش كله في معاملة واحدة مع التدقيق.
    const parsedRows = rows.map((row) => foundationItemSchema.parse(row));
    const user = actor(req);
    const applied = await db.transaction(async (tx) => {
      const results: Array<{ code: string; action: "created" | "updated" }> = [];
      for (const parsed of parsedRows) {
        const [existing] = await tx.select().from(foundationItemsTable)
          .where(sql`lower(${foundationItemsTable.code}) = lower(${parsed.code})`).for("update");
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
      await recordAudit(req, "item", null, "imported", { count: results.length }, null, `استيراد دفعي: ${results.length} صف`, tx);
      return results;
    });
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
    const created = await db.transaction(async (tx) => {
      const [item] = await tx.select({ id: foundationItemsTable.id }).from(foundationItemsTable).where(eq(foundationItemsTable.id, itemId));
      if (!item) throw fail(404, "الصنف غير موجود");
      const [row] = await tx.insert(foundationUnitConversionsTable).values(data).returning();
      await recordAudit(req, "unit_conversion", row.id, "created", row, null, null, tx);
      return row;
    });
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

// خطوة 35: كل تعديل + سطر التدقيق بتاعه في معاملة واحدة (ADR 0008)، والإيقاف بيعدّي على محاكي الأثر.
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
type Tx = Pick<typeof db, "select" | "insert" | "update">;

async function requireLocation(tx: Pick<typeof db, "select">, id: number | null | undefined) {
  if (!id) return;
  const [row] = await tx.select({ id: foundationLocationsTable.id }).from(foundationLocationsTable).where(eq(foundationLocationsTable.id, id));
  if (!row) throw fail(422, "الموقع غير موجود");
}

async function requireWorkCenter(tx: Pick<typeof db, "select">, id: number | null | undefined) {
  if (!id) return;
  const [row] = await tx.select({ id: foundationWorkCentersTable.id }).from(foundationWorkCentersTable).where(eq(foundationWorkCentersTable.id, id));
  if (!row) throw fail(422, "مركز العمل غير موجود");
}

/** بيمنع الإيقاف لو فيه مراجع حيّة إلا بسبب صريح (3 حروف على الأقل). */
async function guardInactivation(tx: Pick<typeof db, "select">, kind: ImpactKind, id: number, overrideReason: string | null) {
  const impact = await foundationImpact(tx, kind, id);
  if (impact) assertInactivationAllowed({ entityType: kind, entityId: id, blockers: impact.blockers }, overrideReason);
}

router.get("/foundation/impact/:kind/:id", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const kind = String(req.params.kind) as ImpactKind;
    if (!(IMPACT_KINDS as readonly string[]).includes(kind)) { res.status(404).json({ error: { message: "نوع غير معروف" } }); return; }
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const impact = await foundationImpact(db, kind, id);
    if (!impact) { res.status(404).json({ error: { message: "السجل غير موجود" } }); return; }
    res.json({ ...impact, blocked: hasBlockers(impact) });
  } catch (err) { next(err); }
});

router.get("/foundation/locations", requireRole(...FOUNDATION_ROLES), async (_req, res, next) => {
  try { res.json(await db.select().from(foundationLocationsTable).orderBy(asc(foundationLocationsTable.code))); }
  catch (err) { next(err); }
});

router.post("/foundation/locations", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const data = foundationLocationSchema.parse(req.body);
    const created = await db.transaction(async (tx) => {
      if (data.parentId) {
        const [parent] = await tx.select({ id: foundationLocationsTable.id }).from(foundationLocationsTable).where(eq(foundationLocationsTable.id, data.parentId));
        if (!parent) throw fail(422, "الموقع الأب غير موجود");
      }
      const [row] = await tx.insert(foundationLocationsTable).values(data).returning();
      await recordAudit(req, "location", row.id, "created", row, null, null, tx);
      return row;
    });
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/locations/:id", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const data = foundationLocationSchema.partial().parse(req.body);
    const overrideReason = readOverrideReason(req);
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(foundationLocationsTable).where(eq(foundationLocationsTable.id, id)).for("update");
      if (!before) throw fail(404, "الموقع غير موجود");
      if (data.parentId === id) throw fail(422, "الموقع لا يمكن أن يكون أبًا لنفسه");
      if (data.parentId) {
        let ancestorId: number | null = data.parentId;
        const visited = new Set<number>([id]);
        while (ancestorId !== null) {
          if (visited.has(ancestorId)) throw fail(422, "لا يمكن إنشاء دورة في شجرة المواقع");
          visited.add(ancestorId);
          const [ancestor] = await tx.select({ parentId: foundationLocationsTable.parentId }).from(foundationLocationsTable).where(eq(foundationLocationsTable.id, ancestorId));
          if (!ancestor) throw fail(422, "الموقع الأب غير موجود");
          ancestorId = ancestor.parentId;
        }
      }
      if (before.active && data.active === false) await guardInactivation(tx, "location", id, overrideReason);
      const [row] = await tx.update(foundationLocationsTable).set({ ...data, updatedAt: new Date() }).where(eq(foundationLocationsTable.id, id)).returning();
      await recordAudit(req, "location", id, "updated", row, before, overrideReason, tx);
      return row;
    });
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
    const created = await db.transaction(async (tx) => {
      await requireLocation(tx, data.locationId);
      const [row] = await tx.insert(foundationWorkCentersTable).values(data).returning();
      await recordAudit(req, "work_center", row.id, "created", row, null, null, tx);
      return row;
    });
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/work-centers/:id", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const data = foundationWorkCenterSchema.partial().parse(req.body);
    const overrideReason = readOverrideReason(req);
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(foundationWorkCentersTable).where(eq(foundationWorkCentersTable.id, id)).for("update");
      if (!before) throw fail(404, "مركز العمل غير موجود");
      await requireLocation(tx, data.locationId);
      if (before.active && data.active === false) await guardInactivation(tx, "work-center", id, overrideReason);
      const [row] = await tx.update(foundationWorkCentersTable).set({ ...data, updatedAt: new Date() }).where(eq(foundationWorkCentersTable.id, id)).returning();
      await recordAudit(req, "work_center", id, "updated", row, before, overrideReason, tx);
      return row;
    });
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
    const created = await db.transaction(async (tx) => {
      await requireWorkCenter(tx, data.workCenterId);
      const [row] = await tx.insert(foundationMachinesTable).values(data).returning();
      await recordAudit(req, "machine", row.id, "created", row, null, null, tx);
      return row;
    });
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/machines/:id", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const data = foundationMachineSchema.partial().parse(req.body);
    const overrideReason = readOverrideReason(req);
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(foundationMachinesTable).where(eq(foundationMachinesTable.id, id)).for("update");
      if (!before) throw fail(404, "الماكينة غير موجودة");
      await requireWorkCenter(tx, data.workCenterId);
      if (before.active && data.active === false) await guardInactivation(tx, "machine", id, overrideReason);
      const [row] = await tx.update(foundationMachinesTable).set({ ...data, updatedAt: new Date() }).where(eq(foundationMachinesTable.id, id)).returning();
      await recordAudit(req, "machine", id, "updated", row, before, overrideReason, tx);
      return row;
    });
    res.json(updated);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/machines/:id/status", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const status = foundationMachineSchema.shape.status.parse(req.body.status);
    const reason = typeof req.body.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : null;
    const overrideReason = readOverrideReason(req);
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(foundationMachinesTable).where(eq(foundationMachinesTable.id, id)).for("update");
      if (!before) throw fail(404, "الماكينة غير موجودة");
      // الإحالة للتقاعد بتتعامل زي الإيقاف: لو متربطة بمسار تشغيل مُصدر لازم سبب صريح.
      if (status === "retired" && before.status !== "retired") await guardInactivation(tx, "machine", id, overrideReason);
      const [row] = await tx.update(foundationMachinesTable).set({ status, updatedAt: new Date() }).where(eq(foundationMachinesTable.id, id)).returning();
      await recordAudit(req, "machine", id, "status_changed", row, before, reason ?? overrideReason, tx);
      return row;
    });
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
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(foundationShiftsTable).values(data).returning();
      await recordAudit(req, "shift", row.id, "created", row, null, null, tx);
      return row;
    });
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/shifts/:id", requireRole(...FOUNDATION_ROLES), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const data = foundationShiftSchema.partial().parse(req.body);
    const overrideReason = readOverrideReason(req);
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(foundationShiftsTable).where(eq(foundationShiftsTable.id, id)).for("update");
      if (!before) throw fail(404, "الوردية غير موجودة");
      if (before.active && data.active === false) await guardInactivation(tx, "shift", id, overrideReason);
      const [row] = await tx.update(foundationShiftsTable).set({ ...data, updatedAt: new Date() }).where(eq(foundationShiftsTable.id, id)).returning();
      await recordAudit(req, "shift", id, "updated", row, before, overrideReason, tx);
      return row;
    });
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
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(phase0NumberSequencesTable).values(data).returning();
      await recordAudit(req, "number_sequence", row.id, "created", row, null, null, tx);
      return row;
    });
    res.status(201).json(created);
  } catch (err) { forward(err, next); }
});

router.patch("/foundation/number-sequences/:id", requireRole("chairman"), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const data = phase0NumberSequenceSchema.partial().parse(req.body);
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(phase0NumberSequencesTable).where(eq(phase0NumberSequencesTable.id, id)).for("update");
      if (!before) throw fail(404, "عداد الترقيم غير موجود");
      // تقليل العدّاد معناه إعادة أرقام اتصرفت قبل كده (تكرار مستندات)، فمتاح الزيادة بس.
      if (data.nextValue !== undefined && data.nextValue < Number(before.nextValue)) {
        throw fail(409, `مينفعش تقلّل العدّاد (الحالي ${before.nextValue}). التقليل بيكرّر أرقام مستندات اتصرفت.`);
      }
      const [row] = await tx.update(phase0NumberSequencesTable).set({ ...data, updatedAt: new Date() }).where(eq(phase0NumberSequencesTable.id, id)).returning();
      await recordAudit(req, "number_sequence", id, "updated", row, before, null, tx);
      return row;
    });
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