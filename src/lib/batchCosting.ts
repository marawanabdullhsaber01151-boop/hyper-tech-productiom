/** @format */
// التكلفة المعيارية وكشف تكلفة الدفعة (54). كل الدوال جوه معاملة المتصل (أو قراءة بس). ترتيب الأقفال للكتابة:
//   قفل الدفعة (hashtext) ← صف المعيار/الكشف FOR UPDATE ← الحساب من قيود التكلفة ← الكتابة ← التدقيق.
// الكشف المسودة بيتعاد حسابه. الكشف النهائي مبيتعدّلش (ترجر القاعدة + فحص الكود).
import { sql } from "drizzle-orm";
import { writeAuditEvent } from "./governance";
import {
  actualFor, centsText, computeSheet, divRound, materialPerBatch, milliText, parseCents, parseMilli, pickUnitPrice, parseScaled,
  type CostEntryLite, type Sheet, type SheetInput, type StandardInput,
} from "./batchCostingCore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exec = any;

export class CostingError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface Actor { userId: number; username: string; ip?: string | null; userAgent?: string | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const rows = (r: unknown): Row[] => (r as { rows: Row[] }).rows;

/* ---------------- المعيار ---------------- */
export async function listStandards(exec: Exec) {
  const res = rows(await exec.execute(sql`
    select r.id, r.product_name, r.product_code, r.output_qty::text as output_qty, r.is_active,
      coalesce((select sum(round(i.qty * i.unit_cost, 2)) from bom_recipe_items i where i.recipe_id = r.id), 0)::text as material,
      s.labor::text, s.machine::text, s.energy::text, s.overhead::text, s.yield_percent::text, s.version, s.updated_by_name, s.updated_at
    from bom_recipes r left join recipe_standard_costs s on s.recipe_id = r.id
    where r.is_active order by r.product_name limit 500`));
  return res.map((r) => ({
    recipeId: Number(r.id), productName: String(r.product_name), productCode: (r.product_code as string | null) ?? null, outputQty: String(r.output_qty),
    material: String(r.material), hasStandard: r.version !== null,
    labor: r.labor ?? "0.00", machine: r.machine ?? "0.00", energy: r.energy ?? "0.00", overhead: r.overhead ?? "0.00", yieldPercent: r.yield_percent ?? "100.00",
    version: r.version === null ? 0 : Number(r.version), updatedByName: (r.updated_by_name as string | null) ?? null, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }));
}

export interface StandardBody { labor: string; machine: string; energy: string; overhead: string; yieldPercent: string; reason: string }

export async function setStandard(tx: Exec, recipeId: number, b: StandardBody, by: Actor): Promise<{ version: number }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`recipe_standard:${recipeId}`}))`);
  const rec = rows(await tx.execute(sql`select id from bom_recipes where id = ${recipeId}`))[0];
  if (!rec) throw new CostingError(404, "NOT_FOUND", "الوصفة مش موجودة");
  const cur = rows(await tx.execute(sql`select labor::text, machine::text, energy::text, overhead::text, yield_percent::text, version from recipe_standard_costs where recipe_id = ${recipeId} for update`))[0];
  const version = cur ? Number(cur.version) + 1 : 1;
  await tx.execute(sql`
    insert into recipe_standard_costs (recipe_id, labor, machine, energy, overhead, yield_percent, version, updated_by, updated_by_name, updated_at)
    values (${recipeId}, ${b.labor}::numeric, ${b.machine}::numeric, ${b.energy}::numeric, ${b.overhead}::numeric, ${b.yieldPercent}::numeric, ${version}, ${by.userId}, ${by.username}, now())
    on conflict (recipe_id) do update set labor = excluded.labor, machine = excluded.machine, energy = excluded.energy, overhead = excluded.overhead,
      yield_percent = excluded.yield_percent, version = excluded.version, updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now()`);
  await tx.execute(sql`
    insert into recipe_standard_history (recipe_id, version, labor, machine, energy, overhead, yield_percent, reason, changed_by, changed_by_name)
    values (${recipeId}, ${version}, ${b.labor}::numeric, ${b.machine}::numeric, ${b.energy}::numeric, ${b.overhead}::numeric, ${b.yieldPercent}::numeric, ${b.reason.trim()}, ${by.userId}, ${by.username})`);
  await writeAuditEvent({ executor: tx, actorUserId: by.userId, actorName: by.username, actionKey: "costing.standard_set", resourceType: "bom_recipe", resourceId: recipeId, beforeData: cur ?? null, afterData: { ...b, version }, reason: b.reason.trim(), ipAddress: by.ip ?? null, userAgent: by.userAgent ?? null });
  return { version };
}

export async function standardHistory(exec: Exec, recipeId: number) {
  return rows(await exec.execute(sql`select version, labor::text, machine::text, energy::text, overhead::text, yield_percent::text, reason, changed_by_name, created_at from recipe_standard_history where recipe_id = ${recipeId} order by version desc limit 50`))
    .map((r) => ({ version: Number(r.version), labor: String(r.labor), machine: String(r.machine), energy: String(r.energy), overhead: String(r.overhead), yieldPercent: String(r.yield_percent), reason: String(r.reason), changedByName: String(r.changed_by_name), createdAt: new Date(r.created_at).toISOString() }));
}

/* ---------------- كشف الدفعة ---------------- */
export interface BatchMeta { batchId: number; batchNumber: string; batchStatus: string; orderId: number; orderNumber: string; productName: string; recipeId: number | null; standardVersion: number | null }

async function loadInputs(exec: Exec, batchId: number, forUpdate = false): Promise<{ meta: BatchMeta; input: SheetInput }> {
  const b = rows(await exec.execute(sql`
    select b.id, b.batch_number, b.status, b.workflow_order_id, b.produced_qty::text as produced, b.accepted_qty::text as accepted, b.scrap_qty::text as scrap, b.rework_qty::text as rework,
      o.order_number, o.product_name, o.bom_recipe_id, o.sales_order_id
    from production_batches b join production_workflow_orders o on o.id = b.workflow_order_id where b.id = ${batchId}`))[0];
  if (!b) throw new CostingError(404, "NOT_FOUND", "الدفعة مش موجودة");
  const orderId = Number(b.workflow_order_id);
  const batches = rows(await exec.execute(sql`select id, produced_qty::text as produced from production_batches where workflow_order_id = ${orderId}`)).map((r) => ({ id: Number(r.id), producedMilli: parseMilli(r.produced) }));
  const entries: CostEntryLite[] = rows(await exec.execute(sql`select cost_type, amount::text as amount, batch_id from production_cost_entries where workflow_order_id = ${orderId} and status = 'approved'`))
    .map((r) => ({ costType: String(r.cost_type), amountCents: parseCents(r.amount), batchId: r.batch_id === null ? null : Number(r.batch_id) }));
  const recipeId = b.bom_recipe_id === null ? null : Number(b.bom_recipe_id);
  let standard: StandardInput | null = null;
  let standardVersion: number | null = null;
  let recipeMissing = recipeId === null;
  let refPrice: string | null = null;
  if (recipeId !== null) {
    const r = rows(await exec.execute(sql`select output_qty::text as output_qty, reference_price::text as reference_price from bom_recipes where id = ${recipeId}`))[0];
    if (!r) recipeMissing = true;
    else {
      refPrice = (r.reference_price as string | null) ?? null;
      const items = rows(await exec.execute(sql`select qty::text as qty, unit_cost::text as unit_cost from bom_recipe_items where recipe_id = ${recipeId}`)).map((x) => ({ qty: String(x.qty), unitCost: String(x.unit_cost) }));
      const s = rows(await exec.execute(forUpdate
        ? sql`select labor::text, machine::text, energy::text, overhead::text, yield_percent::text, version from recipe_standard_costs where recipe_id = ${recipeId} for share`
        : sql`select labor::text, machine::text, energy::text, overhead::text, yield_percent::text, version from recipe_standard_costs where recipe_id = ${recipeId}`))[0];
      if (s) {
        standardVersion = Number(s.version);
        standard = {
          outputQtyMilli: parseMilli(r.output_qty), materialPerBatchCents: materialPerBatch(items), laborCents: parseCents(s.labor), machineCents: parseCents(s.machine),
          energyCents: parseCents(s.energy), overheadCents: parseCents(s.overhead), yieldBp: parseScaled(s.yield_percent, 2),
        };
      } else if (items.length > 0) {
        // مفيش معيار محفوظ: الخامات المعيارية من الوصفة بس، والباقي صفر (والكشف بيحذّر NO_STANDARD)
        standard = { outputQtyMilli: parseMilli(r.output_qty), materialPerBatchCents: materialPerBatch(items), laborCents: 0n, machineCents: 0n, energyCents: 0n, overheadCents: 0n, yieldBp: 10000n };
      }
    }
  }
  const lines = b.sales_order_id === null ? [] : rows(await exec.execute(sql`select description, qty::text as qty, unit_price::text as unit_price from sales_order_items where order_id = ${Number(b.sales_order_id)}`))
    .map((x) => ({ description: String(x.description), qty: String(x.qty), unitPrice: String(x.unit_price) }));
  const price = pickUnitPrice(String(b.product_name), lines, refPrice);
  const input: SheetInput = {
    standard, recipeMissing, producedMilli: parseMilli(b.produced), acceptedMilli: parseMilli(b.accepted), scrapMilli: parseMilli(b.scrap), reworkMilli: parseMilli(b.rework),
    actual: actualFor(entries, batchId, batches), price,
  };
  return { meta: { batchId, batchNumber: String(b.batch_number), batchStatus: String(b.status), orderId, orderNumber: String(b.order_number), productName: String(b.product_name), recipeId, standardVersion }, input };
}

export interface SheetView {
  meta: BatchMeta;
  warnings: Sheet["warnings"];
  saved: { status: "draft" | "final"; computedAt: string; computedByName: string; finalizedAt: string | null; finalizedByName: string | null } | null;
  qty: { produced: string; accepted: string; scrap: string; rework: string; yieldPercent: string | null };
  std: Record<"material" | "labor" | "machine" | "energy" | "overhead" | "total", string>;
  act: Record<"material" | "labor" | "machine" | "energy" | "overhead" | "waste" | "total", string>;
  variance: Record<"material" | "labor" | "machine" | "energy" | "overhead" | "waste" | "total", string>;
  efficiencyLoss: string;
  unitCost: string | null;
  unitPrice: string | null;
  priceSource: string | null;
  revenue: string | null;
  profit: string | null;
  marginPercent: string | null;
}

/** نسبة بالـbasis points ← نص «97.50». */
const bp = (v: bigint | null): string | null => (v === null ? null : centsText(v));

function toView(meta: BatchMeta, input: SheetInput, s: Sheet, saved: SheetView["saved"]): SheetView {
  const c = centsText;
  return {
    meta, warnings: s.warnings, saved,
    qty: { produced: milliText(input.producedMilli), accepted: milliText(input.acceptedMilli), scrap: milliText(input.scrapMilli), rework: milliText(input.reworkMilli), yieldPercent: bp(s.yieldActualBp) },
    std: { material: c(s.std.material), labor: c(s.std.labor), machine: c(s.std.machine), energy: c(s.std.energy), overhead: c(s.std.overhead), total: c(s.stdTotal) },
    act: { material: c(s.act.material), labor: c(s.act.labor), machine: c(s.act.machine), energy: c(s.act.energy), overhead: c(s.act.overhead), waste: c(s.act.waste), total: c(s.actTotal) },
    variance: { material: c(s.variance.material), labor: c(s.variance.labor), machine: c(s.variance.machine), energy: c(s.variance.energy), overhead: c(s.variance.overhead), waste: c(s.variance.waste), total: c(s.variance.total) },
    efficiencyLoss: c(s.efficiencyLoss),
    unitCost: s.unitCostCents === null ? null : c(s.unitCostCents),
    unitPrice: s.unitPriceCents === null ? null : c(s.unitPriceCents), priceSource: s.priceSource,
    revenue: s.revenueCents === null ? null : c(s.revenueCents), profit: s.profitCents === null ? null : c(s.profitCents), marginPercent: bp(s.marginBp),
  };
}

const savedOf = (r: Row | undefined): SheetView["saved"] => (r ? { status: r.status, computedAt: new Date(r.computed_at).toISOString(), computedByName: String(r.computed_by_name), finalizedAt: r.finalized_at ? new Date(r.finalized_at).toISOString() : null, finalizedByName: (r.finalized_by_name as string | null) ?? null } : null);

/** الكشف: لو نهائي بيرجّع المحفوظ زي ما هو، وإلا بيتحسب دلوقتي (مسودة). */
export async function viewBatchSheet(exec: Exec, batchId: number): Promise<SheetView> {
  const saved = rows(await exec.execute(sql`select * from batch_cost_sheets where batch_id = ${batchId}`))[0];
  const { meta, input } = await loadInputs(exec, batchId);
  if (saved?.status === "final") return fromSaved(meta, saved);
  return toView(meta, input, computeSheet(input), savedOf(saved));
}

function fromSaved(meta: BatchMeta, r: Row): SheetView {
  const m = parseCents;
  const c = centsText;
  const v = (a: string, b: string) => c(m(a) - m(b));
  const produced = parseMilli(r.produced_qty);
  const accepted = parseMilli(r.accepted_qty);
  const warnings: Sheet["warnings"] = r.unit_price === null ? ["NO_PRICE"] : [];
  const revenue = r.revenue === null ? null : m(r.revenue);
  return {
    meta: { ...meta, standardVersion: r.standard_version === null ? null : Number(r.standard_version) }, warnings, saved: savedOf(r),
    qty: { produced: milliText(produced), accepted: milliText(accepted), scrap: milliText(parseMilli(r.scrap_qty)), rework: milliText(parseMilli(r.rework_qty)), yieldPercent: produced > 0n ? bp(divRound(accepted * 10000n, produced)) : null },
    std: { material: r.std_material, labor: r.std_labor, machine: r.std_machine, energy: r.std_energy, overhead: r.std_overhead, total: r.std_total },
    act: { material: r.act_material, labor: r.act_labor, machine: r.act_machine, energy: r.act_energy, overhead: r.act_overhead, waste: r.act_waste, total: r.act_total },
    variance: { material: v(r.act_material, r.std_material), labor: v(r.act_labor, r.std_labor), machine: v(r.act_machine, r.std_machine), energy: v(r.act_energy, r.std_energy), overhead: v(r.act_overhead, r.std_overhead), waste: r.act_waste, total: r.variance_total },
    efficiencyLoss: r.efficiency_loss,
    unitCost: accepted > 0n ? c(divRound(m(r.act_total) * 1000n, accepted)) : null,
    unitPrice: r.unit_price, priceSource: r.price_source, revenue: r.revenue, profit: r.profit,
    marginPercent: revenue !== null && revenue > 0n ? bp(divRound(m(r.profit) * 10000n, revenue)) : null,
  };
}

async function writeSheet(tx: Exec, batchId: number, by: Actor, finalize: boolean): Promise<SheetView> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`batch_cost:${batchId}`}))`);
  const ex = rows(await tx.execute(sql`select status from batch_cost_sheets where batch_id = ${batchId} for update`))[0];
  if (ex?.status === "final") throw new CostingError(409, "SHEET_FINAL", "كشف التكلفة ده نهائي ومينفعش يتعدّل");
  const { meta, input } = await loadInputs(tx, batchId, true);
  if (finalize && meta.batchStatus !== "completed") throw new CostingError(409, "BATCH_NOT_COMPLETED", "اقفل الدفعة الأول (مكتملة) وبعدين اعتمد كشف التكلفة");
  const s = computeSheet(input);
  const c = centsText;
  const status = finalize ? "final" : "draft";
  const price = s.unitPriceCents === null ? null : c(s.unitPriceCents);
  await tx.execute(sql`
    insert into batch_cost_sheets (batch_id, order_id, recipe_id, status, standard_version, produced_qty, accepted_qty, scrap_qty, rework_qty,
      std_material, std_labor, std_machine, std_energy, std_overhead, act_material, act_labor, act_machine, act_energy, act_overhead, act_waste,
      std_total, act_total, variance_total, efficiency_loss, unit_price, price_source, revenue, profit, computed_by, computed_by_name, computed_at, finalized_by_name, finalized_at)
    values (${batchId}, ${meta.orderId}, ${meta.recipeId}, ${status}, ${meta.standardVersion}, ${milliText(input.producedMilli)}::numeric, ${milliText(input.acceptedMilli)}::numeric, ${milliText(input.scrapMilli)}::numeric, ${milliText(input.reworkMilli)}::numeric,
      ${c(s.std.material)}::numeric, ${c(s.std.labor)}::numeric, ${c(s.std.machine)}::numeric, ${c(s.std.energy)}::numeric, ${c(s.std.overhead)}::numeric,
      ${c(s.act.material)}::numeric, ${c(s.act.labor)}::numeric, ${c(s.act.machine)}::numeric, ${c(s.act.energy)}::numeric, ${c(s.act.overhead)}::numeric, ${c(s.act.waste)}::numeric,
      ${c(s.stdTotal)}::numeric, ${c(s.actTotal)}::numeric, ${c(s.variance.total)}::numeric, ${c(s.efficiencyLoss)}::numeric, ${price}::numeric, ${s.priceSource},
      ${s.revenueCents === null ? null : c(s.revenueCents)}::numeric, ${s.profitCents === null ? null : c(s.profitCents)}::numeric, ${by.userId}, ${by.username}, now(),
      ${finalize ? by.username : null}, ${finalize ? sql`now()` : null})
    on conflict (batch_id) do update set status = excluded.status, standard_version = excluded.standard_version, produced_qty = excluded.produced_qty, accepted_qty = excluded.accepted_qty,
      scrap_qty = excluded.scrap_qty, rework_qty = excluded.rework_qty, std_material = excluded.std_material, std_labor = excluded.std_labor, std_machine = excluded.std_machine,
      std_energy = excluded.std_energy, std_overhead = excluded.std_overhead, act_material = excluded.act_material, act_labor = excluded.act_labor, act_machine = excluded.act_machine,
      act_energy = excluded.act_energy, act_overhead = excluded.act_overhead, act_waste = excluded.act_waste, std_total = excluded.std_total, act_total = excluded.act_total,
      variance_total = excluded.variance_total, efficiency_loss = excluded.efficiency_loss, unit_price = excluded.unit_price, price_source = excluded.price_source,
      revenue = excluded.revenue, profit = excluded.profit, computed_by = excluded.computed_by, computed_by_name = excluded.computed_by_name, computed_at = now(),
      finalized_by_name = excluded.finalized_by_name, finalized_at = excluded.finalized_at`);
  await writeAuditEvent({ executor: tx, actorUserId: by.userId, actorName: by.username, actionKey: finalize ? "costing.sheet_finalized" : "costing.sheet_computed", resourceType: "production_batch", resourceId: batchId, afterData: { status, actualTotal: c(s.actTotal), standardTotal: c(s.stdTotal), variance: c(s.variance.total) }, ipAddress: by.ip ?? null, userAgent: by.userAgent ?? null });
  const saved = rows(await tx.execute(sql`select * from batch_cost_sheets where batch_id = ${batchId}`))[0];
  return finalize ? fromSaved(meta, saved) : toView(meta, input, s, savedOf(saved));
}

export const saveBatchSheet = (tx: Exec, batchId: number, by: Actor) => writeSheet(tx, batchId, by, false);
export const finalizeBatchSheet = (tx: Exec, batchId: number, by: Actor) => writeSheet(tx, batchId, by, true);

/** قايمة الدفعات للمتابعة: الأحدث الأول، مع حالة الكشف وأرقامه لو متحفوظ. */
export async function listBatches(exec: Exec, opts: { status?: "completed" | "open" | "all"; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const st = opts.status ?? "all";
  const res = rows(await exec.execute(sql`
    select b.id, b.batch_number, b.status, b.produced_qty::text as produced, b.accepted_qty::text as accepted, b.completed_at, o.id as order_id, o.order_number, o.product_name,
      s.status as sheet_status, s.act_total::text as act_total, s.std_total::text as std_total, s.variance_total::text as variance_total, s.profit::text as profit
    from production_batches b join production_workflow_orders o on o.id = b.workflow_order_id left join batch_cost_sheets s on s.batch_id = b.id
    where (${st} = 'all' or (${st} = 'completed' and b.status = 'completed') or (${st} = 'open' and b.status <> 'completed'))
    order by b.id desc limit ${limit}`));
  return res.map((r) => ({
    batchId: Number(r.id), batchNumber: String(r.batch_number), status: String(r.status), produced: String(r.produced), accepted: String(r.accepted), completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    orderId: Number(r.order_id), orderNumber: String(r.order_number), productName: String(r.product_name),
    sheetStatus: (r.sheet_status as string | null) ?? null, actualTotal: (r.act_total as string | null) ?? null, standardTotal: (r.std_total as string | null) ?? null, varianceTotal: (r.variance_total as string | null) ?? null, profit: (r.profit as string | null) ?? null,
  }));
}
