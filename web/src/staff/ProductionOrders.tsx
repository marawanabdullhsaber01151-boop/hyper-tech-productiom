import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, Textarea, type Column } from "../design/components";
import { Plus, RefreshCw } from "../design/icons";
import { formatDate, formatDateTime, formatNumber } from "../lib/format";
import { MaterialsDialog } from "./ProductionMaterials";
import {
  ORDER_PRIORITIES,
  canCreateOrder,
  canEditNeededBy,
  countByStatus,
  createError,
  groupOf,
  isOverdue,
  isWaitingForRole,
  leastLoaded,
  partialQtyError,
  orderActions,
  stageIndex,
  STAGES,
  ownerRoleKey,
  receiveError,
  type OrderAction,
} from "./orderRules";

export interface OrderRow {
  id: number;
  orderNumber: string;
  productName: string;
  qty: string;
  unit: string;
  priority: string;
  workflowStatus: string;
  neededBy: string | null;
  createdById?: number;
  lifecycleRevision?: number;
  currentStage?: string | null;
  createdByName?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  orderDetails?: string | null;
  productionLine?: string | null;
  startDate?: string | null;
  suggestedDueDate?: string | null;
  cancelReason?: string | null;
}
interface Recipe { id: number; productName: string; productCode: string | null }
interface Member { id: number; fullName: string; activeCount: number }
interface Lifecycle {
  blockedGates?: Array<{ key: string; label: string; blocked: boolean; detail?: string }>;
  conformance?: { ok: boolean };
  children?: Array<{ id: number; orderNumber: string; workflowStatus: string }>;
  timeline?: Array<{ id: number; toStatus: string; actorName: string | null; reason: string | null; createdAt: string }>;
}

const val = (e: Event) => (e.target as HTMLInputElement).value;
const today = () => new Date().toISOString().slice(0, 10);
/** الأزرار اللي بتظهر في الصف مباشرة (الباقي جوّه التفاصيل عشان الجدول ما يزدحمش). */
const ROW_ACTIONS: readonly OrderAction[] = ["advance", "receive", "decide", "dispatch", "deliver", "confirm", "resume"];
const LINE_KEY = "hyper_prd_last_line";
const readLine = () => { try { return localStorage.getItem(LINE_KEY) ?? ""; } catch { return ""; } };
const TONE: Record<string, "warn" | "info" | "success" | "danger" | "neutral"> = { waiting: "warn", inProgress: "info", done: "success", cancelled: "neutral" };
const PRIO_TONE: Record<string, "danger" | "warn" | "neutral"> = { urgent: "danger", high: "warn", normal: "neutral", low: "neutral" };
const statusLabel = (s: string) => t(`prd.ord.status.${s}` as CopyKey);
const stageLabel = (s: string) => t(`prd.ord.stage.${s}` as CopyKey);
const prioLabel = (p: string) => t(`prd.prio.${p}` as CopyKey);

/** أوامر الإنتاج: القايمة، «عند مين الأمر؟»، سجل الحركة، والإجراءات المسموحة لدورك فقط. */
export function ProductionOrders() {
  const user = staffUser();
  const role = user?.role ?? "";
  // المشرف والمخزن يفتحوا على «ينتظر إجراءك» (شغلهم بس)، والباقي على الكل.
  const [filter, setFilter] = useState(() => (role === "supervisor" || role === "warehouse_manager" || role === "storekeeper" ? "mine" : ""));
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<OrderRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<{ row: OrderRow; kind: OrderAction | "due" } | null>(null);
  const list = useQuery((signal) => api.get<OrderRow[]>("/production-workflow", { signal }), []);
  const all = Array.isArray(list.data) ? list.data : [];
  const counts = countByStatus(all);
  const d = today();
  const q = search.trim();
  const rows = all.filter((r) => {
    if (filter === "mine" ? !isWaitingForRole(role, r.workflowStatus) : filter && r.workflowStatus !== filter) return false;
    if (!q) return true;
    return [r.orderNumber, r.productName, r.customerName ?? ""].some((x) => x.includes(q));
  });
  const groups = { waiting: 0, inProgress: 0, done: 0 };
  for (const r of all) { const g = groupOf(r.workflowStatus); if (g !== "cancelled") groups[g] += 1; }
  const late = all.filter((r) => isOverdue(r.neededBy, r.workflowStatus, d)).length;
  const mine = all.filter((r) => isWaitingForRole(role, r.workflowStatus)).length;

  const columns: Column<OrderRow>[] = [
    { key: "no", header: t("prd.ord.col.no"), cell: (r) => <strong>{r.orderNumber}</strong>, mobile: "title" },
    { key: "product", header: t("prd.ord.col.product"), cell: (r) => (
      <div class="prd-status">
        <span>{r.productName}</span>
        <StatusPill tone={PRIO_TONE[r.priority] ?? "neutral"}>{prioLabel(r.priority)}</StatusPill>
      </div>
    ) },
    { key: "qty", header: t("prd.ord.col.qty"), cell: (r) => `${formatNumber(Number(r.qty))} ${r.unit}`, numeric: true, mobile: "hide" },
    { key: "status", header: t("prd.ord.col.status"), cell: (r) => (
      <div class="prd-status">
        <StatusPill tone={TONE[groupOf(r.workflowStatus)] ?? "neutral"}>{statusLabel(r.workflowStatus)}</StatusPill>
        <small class="prd-muted">{t(`prd.ord.why.${r.workflowStatus}` as CopyKey)}</small>
        {r.workflowStatus === "in_production" ? <small class="prd-muted">{t("prd.ord.stage.of", { n: stageIndex(r.currentStage) + 1, total: STAGES.length, name: stageLabel(STAGES[stageIndex(r.currentStage)]!) })}</small> : null}
      </div>
    ) },
    { key: "owner", header: t("prd.ord.col.owner"), cell: (r) => t(`prd.ord.owner.${ownerRoleKey(r.workflowStatus)}` as CopyKey), mobile: "hide" },
    { key: "due", header: t("prd.ord.col.due"), cell: (r) => (
      <div class="prd-status">
        <span>{r.neededBy ? formatDate(r.neededBy) : "—"}</span>
        {isOverdue(r.neededBy, r.workflowStatus, d) ? <StatusPill tone="danger">{t("prd.ord.late")}</StatusPill> : null}
      </div>
    ), mobile: "hide" },
    { key: "act", header: t("prd.ord.col.action"), cell: (r) => (
      <div class="prd-actions">
        <Button size="sm" variant="secondary" onClick={() => setOpen(r)}>{t("prd.ord.open")}</Button>
        {orderActions(role, r.workflowStatus).filter((k) => ROW_ACTIONS.includes(k)).map((k) => (
          <Button key={k} size="sm" onClick={() => setDialog({ row: r, kind: k })}>{t(`prd.ord.act.${k}` as CopyKey)}</Button>
        ))}
      </div>
    ) },
  ];

  const refresh = async () => { await list.refetch(); };
  return (
    <>
      <div class="prd-stats">
        <Stat label={t("prd.ord.stat.total")} value={formatNumber(all.length)} />
        <Stat label={t("prd.ord.stat.waiting")} value={formatNumber(groups.waiting)} tone="warn" />
        <Stat label={t("prd.ord.stat.inProgress")} value={formatNumber(groups.inProgress)} tone="brand" />
        <Stat label={t("prd.ord.stat.done")} value={formatNumber(groups.done)} tone="success" />
        <Stat label={t("prd.ord.stat.late")} value={formatNumber(late)} tone="danger" />
        <Stat label={t("prd.ord.stat.mine")} value={formatNumber(mine)} tone="brand" />
      </div>
      <p class="prd-muted">{t("prd.ord.cycle", { active: formatNumber(groups.waiting + groups.inProgress), done: formatNumber(groups.done), late: formatNumber(late) })}</p>
      <div class="prd-toolbar">
        <Select
          aria-label={t("prd.ord.col.status")}
          value={filter}
          options={[
            { value: "", label: t("prd.ord.filter.all") },
            { value: "mine", label: `${t("prd.ord.filter.mine")} (${formatNumber(mine)})` },
            ...Object.keys(counts).map((s) => ({ value: s, label: `${statusLabel(s)} (${formatNumber(counts[s] ?? 0)})` })),
          ]}
          onChange={(e) => setFilter(val(e))}
        />
        <Input aria-label={t("prd.ord.search")} placeholder={t("prd.ord.search")} value={search} onInput={(e) => setSearch(val(e))} />
        <Button variant="ghost" icon={RefreshCw} onClick={() => void refresh()}>{t("prd.ord.refresh")}</Button>
        {canCreateOrder(role) ? <Button icon={Plus} onClick={() => setCreating(true)}>{t("prd.ord.new")}</Button> : null}
      </div>
      {list.error ? <InlineAlert tone="danger" title={t("prd.err")} action={<Button size="sm" variant="secondary" onClick={() => void refresh()}>{t("common.retry")}</Button>}>{list.error.message}</InlineAlert> : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("prd.ord.caption")} loading={list.loading} empty={<EmptyState title={t("prd.ord.empty")} compact />} />
      {open ? <OrderDetail row={open} role={role} userId={user?.id} onClose={() => setOpen(null)} onAction={(kind) => { const row = open; setOpen(null); setDialog({ row, kind }); }} /> : null}
      {creating ? <NewOrderDialog onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await refresh(); }} /> : null}
      {dialog?.kind === "decide" ? <MaterialsDialog row={dialog.row} role={role} onClose={() => setDialog(null)} onDone={async () => { setDialog(null); await refresh(); }} /> : null}
      {dialog && dialog.kind !== "decide" ? <OrderDialog row={dialog.row} kind={dialog.kind} onClose={() => setDialog(null)} onDone={async () => { setDialog(null); await refresh(); }} /> : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return <div class="prd-kv"><span class="prd-muted">{label}</span><span>{value || "—"}</span></div>;
}

function OrderDetail({ row, role, userId, onClose, onAction }: { row: OrderRow; role: string; userId: number | undefined; onClose: () => void; onAction: (k: OrderAction | "due") => void }) {
  const life = useQuery((signal) => api.get<Lifecycle>(`/production-workflow/${row.id}/lifecycle`, { signal }), [row.id]);
  const acts = orderActions(role, row.workflowStatus);
  const timeline = life.data?.timeline ?? [];
  const gates = (life.data?.blockedGates ?? []).filter((g) => g.blocked);
  const children = life.data?.children ?? [];
  return (
    <Dialog open onClose={onClose} title={t("prd.ord.d.title", { no: row.orderNumber })} footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}>
      <div class="prd-form">
        <StatusPill tone={TONE[groupOf(row.workflowStatus)] ?? "neutral"}>{statusLabel(row.workflowStatus)}</StatusPill>
        <p class="prd-muted">{t(`prd.ord.why.${row.workflowStatus}` as CopyKey)} {t(`prd.ord.owner.${ownerRoleKey(row.workflowStatus)}` as CopyKey)}</p>
        {row.workflowStatus === "in_production" ? (
          <ol class="prd-stages" aria-label={t("prd.ord.stage.title")}>
            {STAGES.map((s, i) => <li key={s} class={i < stageIndex(row.currentStage) ? "is-done" : i === stageIndex(row.currentStage) ? "is-current" : ""}>{stageLabel(s)}</li>)}
          </ol>
        ) : null}
        <h3 class="prd-h">{t("prd.ord.d.info")}</h3>
        <Row label={t("prd.ord.col.product")} value={`${row.productName} | ${formatNumber(Number(row.qty))} ${row.unit}`} />
        <Row label={t("prd.ord.d.customer")} value={row.customerName ?? t("prd.ord.d.hidden")} />
        {row.customerName !== undefined ? <Row label={t("prd.ord.d.phone")} value={row.customerPhone} /> : null}
        <Row label={t("prd.ord.d.priority")} value={prioLabel(row.priority)} />
        <Row label={t("prd.ord.d.due")} value={row.neededBy ? formatDate(row.neededBy) : null} />
        <Row label={t("prd.ord.d.suggested")} value={row.suggestedDueDate ? formatDate(row.suggestedDueDate) : null} />
        <Row label={t("prd.ord.d.line")} value={row.productionLine} />
        <Row label={t("prd.ord.d.start")} value={row.startDate ? formatDate(row.startDate) : null} />
        <Row label={t("prd.ord.d.created")} value={row.createdByName} />
        {row.orderDetails ? <Row label={t("prd.ord.d.details")} value={row.orderDetails} /> : null}
        {row.cancelReason ? <Row label={t("prd.ord.d.cancelReason")} value={row.cancelReason} /> : null}
        <div class="prd-actions">
          {acts.map((k) => <Button key={k} size="sm" variant={k === "cancel" ? "secondary" : "primary"} onClick={() => onAction(k)}>{t(`prd.ord.act.${k}` as CopyKey)}</Button>)}
          {canEditNeededBy(userId, row) ? <Button size="sm" variant="secondary" onClick={() => onAction("due")}>{t("prd.ord.act.due")}</Button> : null}
        </div>
        <p class="prd-muted">{t("prd.ord.d.otherBoards")}</p>
        {life.error ? <InlineAlert tone="warn">{t("prd.ord.d.lifecycleFail")}</InlineAlert> : null}
        {life.data ? (
          <>
            <h3 class="prd-h">{t("prd.ord.d.gates")}</h3>
            {gates.length ? <ul class="prd-list">{gates.map((g) => <li key={g.key}>{g.label}{g.detail ? ` | ${g.detail}` : ""}</li>)}</ul> : <p class="prd-muted">{t("prd.ord.d.noGates")}</p>}
            {children.length ? <p class="prd-muted">{t("prd.ord.d.children")}: {children.map((c) => c.orderNumber).join(t("prd.ord.d.sep"))}</p> : null}
            <p class="prd-muted">{t("prd.ord.d.conformance")}: {life.data.conformance?.ok === false ? t("prd.ord.d.conformBad") : t("prd.ord.d.conformOk")}</p>
            <h3 class="prd-h">{t("prd.ord.d.timeline")}</h3>
            {timeline.length ? (
              <ol class="prd-list">
                {timeline.map((e) => (
                  <li key={e.id}>
                    <strong>{statusLabel(e.toStatus)}</strong> | {formatDateTime(e.createdAt)}{e.actorName ? ` | ${t("prd.ord.d.by", { name: e.actorName })}` : ""}
                    {e.reason ? <small class="prd-muted"> | {e.reason}</small> : null}
                  </li>
                ))}
              </ol>
            ) : <p class="prd-muted">{t("prd.ord.d.timelineEmpty")}</p>}
          </>
        ) : life.loading ? null : <p class="prd-muted">{t("prd.ord.d.noRights")}</p>}
      </div>
    </Dialog>
  );
}

function OrderDialog({ row, kind, onClose, onDone }: { row: OrderRow; kind: OrderAction | "due"; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const team = useQuery((signal) => (kind === "receive" ? api.get<{ supervisors: Member[]; qualityControllers: Member[] }>("/production-workflow/team-options", { signal }) : Promise.resolve(null)), [kind]);
  const sups = team.data?.supervisors ?? [];
  const qcs = team.data?.qualityControllers ?? [];
  const [supervisorId, setSup] = useState("");
  const [qcId, setQc] = useState("");
  const [line, setLine] = useState(readLine);
  const [startDate, setStart] = useState(today);
  const [operational, setOp] = useState("running");
  const [pendingReason, setPending] = useState("");
  const [reason, setReason] = useState("");
  const [deliveryType, setType] = useState("customer");
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState(row.neededBy?.slice(0, 10) ?? "");
  const [pqty, setPqty] = useState("");
  // اقتراح تلقائي: الأقل حِملًا، لحد ما المستخدم يختار بنفسه.
  const autoSup = supervisorId || String(leastLoaded(sups)?.id ?? "");
  const autoQc = qcId || String(leastLoaded(qcs)?.id ?? "");

  let invalid = false;
  if (kind === "receive") invalid = receiveError({ supervisorId: autoSup, qcId: autoQc, line, startDate, operational, pendingReason }) !== null;
  else if (kind === "cancel") invalid = reason.trim().length < 3;
  else if (kind === "due") invalid = !due || due === row.neededBy?.slice(0, 10);
  else if (kind === "hold" || kind === "rework" || kind === "correct") invalid = reason.trim().length < 3;
  else if (kind === "partial") invalid = partialQtyError(pqty, row.qty) !== null || reason.trim().length < 3;

  const send = async () => {
    const id = row.id;
    const ok = await act.run(async () => {
      if (kind === "advance") await api.patch<unknown>(`/production-workflow/${id}/advance-stage`, {});
      else if (kind === "receive") await api.patch<unknown>(`/production-workflow/${id}/receive`, { supervisorId: Number(autoSup), qualityControllerUserId: Number(autoQc), productionLine: line.trim(), startDate, operationalStatus: operational, pendingReason: operational === "pending" ? pendingReason.trim() : undefined });
      else if (kind === "cancel") await api.patch<unknown>(`/production-workflow/${id}/cancel`, { reason: reason.trim() });
      else if (kind === "deliver") await api.patch<unknown>(`/production-workflow/${id}/deliver`, { deliveryType, deliveryNotes: notes.trim() || undefined });
      else if (kind === "confirm") await api.patch<unknown>(`/production-workflow/${id}/confirm-delivery`, {});
      else if (kind === "dispatch") await api.patch<unknown>(`/production-workflow/${id}/dispatch`, {});
      else if (kind === "partial") await api.post<unknown>(`/production-workflow/${id}/partial-completion`, { quantity: pqty.trim(), reason: reason.trim(), expectedRevision: row.lifecycleRevision });
      else if (kind === "hold" || kind === "resume" || kind === "rework" || kind === "correct") await api.post<unknown>(`/production-workflow/${id}/transition`, { targetStatus: TARGET[kind], reason: reason.trim() || undefined, expectedRevision: row.lifecycleRevision });
      else await api.patch<unknown>(`/production-workflow/${id}/needed-by`, { neededBy: due, reason: reason.trim() || undefined });
      return true;
    }, t(`prd.ord.${kindKey(kind)}.done` as CopyKey));
    if (ok) {
      if (kind === "receive") { try { localStorage.setItem(LINE_KEY, line.trim()); } catch { /* التخزين اختياري */ } }
      await onDone();
    }
  };
  const k = kindKey(kind);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t(`prd.ord.${k}.title` as CopyKey, { no: row.orderNumber })}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={invalid} onClick={() => void send()}>{t(`prd.ord.${k}.send` as CopyKey)}</Button></>}
    >
      <div class="prd-form">
        <p class="prd-muted">{kind === "advance" ? t("prd.ord.a.text", { next: stageLabel(STAGES[Math.min(stageIndex(row.currentStage) + 1, STAGES.length - 1)]!) }) : t(`prd.ord.${k}.text` as CopyKey)}</p>
        <p><strong>{row.productName}</strong> | {formatNumber(Number(row.qty))} {row.unit}</p>
        {kind === "receive" ? (
          <>
            {team.error ? <InlineAlert tone="danger">{t("prd.ord.r.teamFail")}</InlineAlert> : null}
            <p class="prd-muted">{t("prd.ord.r.auto")}</p>
            <Field label={t("prd.ord.r.supervisor")} required>
              <Select value={autoSup} options={[{ value: "", label: t("prd.ord.r.pick") }, ...sups.map((m) => ({ value: String(m.id), label: t("prd.ord.r.load", { name: m.fullName, n: formatNumber(m.activeCount) }) }))]} onChange={(e) => setSup(val(e))} />
            </Field>
            <Field label={t("prd.ord.r.qc")} required>
              <Select value={autoQc} options={[{ value: "", label: t("prd.ord.r.pick") }, ...qcs.map((m) => ({ value: String(m.id), label: t("prd.ord.r.load", { name: m.fullName, n: formatNumber(m.activeCount) }) }))]} onChange={(e) => setQc(val(e))} />
            </Field>
            <Field label={t("prd.ord.r.line")} required><Input value={line} onInput={(e) => setLine(val(e))} /></Field>
            <Field label={t("prd.ord.r.start")} required><Input type="date" value={startDate} onInput={(e) => setStart(val(e))} /></Field>
            <Field label={t("prd.ord.r.operational")}>
              <Select value={operational} options={[{ value: "running", label: t("prd.ord.r.running") }, { value: "pending", label: t("prd.ord.r.pending") }]} onChange={(e) => setOp(val(e))} />
            </Field>
            {operational === "pending" ? <Field label={t("prd.ord.r.pendingReason")} required><Textarea rows={2} maxLength={300} value={pendingReason} onInput={(e) => setPending(val(e))} /></Field> : null}
          </>
        ) : null}
        {kind === "cancel" ? <Field label={t("prd.ord.c.reason")} required error={reason && invalid ? t("prd.ord.c.need") : undefined}><Textarea rows={2} maxLength={300} value={reason} onInput={(e) => setReason(val(e))} /></Field> : null}
        {kind === "partial" ? (
          <Field label={t("prd.ord.p.qty")} required error={pqty && partialQtyError(pqty, row.qty) ? (partialQtyError(pqty, row.qty) === "tooMuch" ? t("prd.ord.p.tooMuch", { max: row.qty }) : t("prd.ord.p.bad")) : undefined}>
            <Input inputMode="decimal" value={pqty} onInput={(e) => setPqty(val(e))} />
          </Field>
        ) : null}
        {kind === "hold" || kind === "rework" || kind === "correct" || kind === "partial" || kind === "resume" ? (
          <Field label={t("prd.ord.reasonLabel")} required={kind !== "resume"} error={reason && reason.trim().length < 3 && kind !== "resume" ? t("prd.ord.reasonNeed") : undefined}><Textarea rows={2} maxLength={300} value={reason} onInput={(e) => setReason(val(e))} /></Field>
        ) : null}
        {kind === "deliver" ? (
          <>
            <Field label={t("prd.ord.v.type")}><Select value={deliveryType} options={[{ value: "customer", label: t("prd.ord.v.customer") }, { value: "warehouse", label: t("prd.ord.v.warehouse") }]} onChange={(e) => setType(val(e))} /></Field>
            <Field label={t("prd.ord.v.notes")}><Textarea rows={2} maxLength={300} value={notes} onInput={(e) => setNotes(val(e))} /></Field>
          </>
        ) : null}
        {kind === "due" ? (
          <>
            <Field label={t("prd.ord.u.date")} required><Input type="date" value={due} onInput={(e) => setDue(val(e))} /></Field>
            <Field label={t("prd.ord.u.reason")}><Textarea rows={2} maxLength={300} value={reason} onInput={(e) => setReason(val(e))} /></Field>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

const KEY = { advance: "a", receive: "r", cancel: "c", deliver: "v", confirm: "f", due: "u", dispatch: "x", hold: "h", resume: "s", rework: "w", partial: "p", correct: "o", decide: "m" } as const;
const kindKey = (kind: OrderAction | "due") => KEY[kind];
/** الحالة الهدف لكل انتقال عام (نفس CANONICAL_PRODUCTION_TRANSITIONS في السيرفر). */
const TARGET = { hold: "held", resume: "in_production", rework: "rework", correct: "corrected" } as const;

const LAST_CUSTOMER_KEY = "hyper_prd_last_customer";
function NewOrderDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const recipes = useQuery((signal) => api.get<Recipe[]>("/production-workflow/recipes", { signal }), []);
  const recipeList = Array.isArray(recipes.data) ? recipes.data : [];
  const [recipeId, setRecipe] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState(() => t("prd.ord.n.unitDefault"));
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [priority, setPriority] = useState("normal");
  const [details, setDetails] = useState("");
  const err = createError({ recipeId, qty, customer, neededBy });
  const save = async () => {
    const recipe = recipeList.find((r) => String(r.id) === recipeId);
    if (!recipe) return;
    const ok = await act.run(async () => {
      await api.post<unknown>("/production-workflow", { bomRecipeId: recipe.id, productName: recipe.productName, qty: qty.trim(), unit: unit.trim() || t("prd.ord.n.unitDefault"), customerName: customer.trim(), customerPhone: phone.trim() || undefined, orderSource: "direct", orderDetails: details.trim() || undefined, priority, neededBy });
      return true;
    }, t("prd.ord.n.done"));
    if (ok) { try { localStorage.setItem(LAST_CUSTOMER_KEY, customer.trim()); } catch { /* التخزين اختياري */ } await onDone(); }
  };
  const last = (() => { try { return localStorage.getItem(LAST_CUSTOMER_KEY) ?? ""; } catch { return ""; } })();
  return (
    <Dialog open onClose={onClose} title={t("prd.ord.n.title")} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={err !== null} onClick={() => void save()}>{t("prd.ord.n.save")}</Button></>}>
      <div class="prd-form">
        <p class="prd-muted">{t("prd.ord.n.text")}</p>
        {recipes.error ? <InlineAlert tone="danger">{t("prd.ord.n.recipesFail")}</InlineAlert> : null}
        <Field label={t("prd.ord.n.recipe")} required>
          <Select value={recipeId} options={[{ value: "", label: t("prd.ord.n.recipePick") }, ...recipeList.map((r) => ({ value: String(r.id), label: r.productCode ? `${r.productName} | ${r.productCode}` : r.productName }))]} onChange={(e) => setRecipe(val(e))} />
        </Field>
        <Field label={t("prd.ord.n.qty")} required error={qty && err === "qty" ? t("prd.ord.n.qtyBad") : undefined}><Input inputMode="decimal" value={qty} onInput={(e) => setQty(val(e))} /></Field>
        <Field label={t("prd.ord.n.unit")}><Input value={unit} onInput={(e) => setUnit(val(e))} /></Field>
        <Field label={t("prd.ord.n.customer")} required hint={last && !customer ? t("prd.ord.n.lastCustomer", { name: last }) : undefined}><Input value={customer} onInput={(e) => setCustomer(val(e))} /></Field>
        <Field label={t("prd.ord.n.phone")}><Input inputMode="tel" value={phone} onInput={(e) => setPhone(val(e))} /></Field>
        <Field label={t("prd.ord.n.due")} required><Input type="date" value={neededBy} onInput={(e) => setNeededBy(val(e))} /></Field>
        <Field label={t("prd.ord.n.priority")}><Select value={priority} options={ORDER_PRIORITIES.map((p) => ({ value: p, label: prioLabel(p) }))} onChange={(e) => setPriority(val(e))} /></Field>
        <Field label={t("prd.ord.n.details")}><Textarea rows={2} maxLength={500} value={details} onInput={(e) => setDetails(val(e))} /></Field>
      </div>
    </Dialog>
  );
}
