import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, Textarea, type Column } from "../design/components";
import { Plus } from "../design/icons";
import { formatDate, formatNumber } from "../lib/format";
import {
  REQUEST_PRIORITIES,
  REQUEST_UNITS,
  canCreateRequest,
  countByStatus,
  directorError,
  isPositiveQty,
  partialQtyError,
  requestActions,
  type DirectorAction,
  type RequestAction,
} from "./productionRules";

interface RequestRow {
  id: number;
  requestNumber: string;
  productName: string;
  requestedQty: string;
  unit: string;
  priority: string;
  status: string;
  createdAt: string;
  workflowOrderNumber: string | null;
}
interface Recipe { id: number; productName: string; productCode: string | null }

const val = (e: Event) => (e.target as HTMLInputElement).value;
const TONE: Record<string, "warn" | "info" | "success" | "danger" | "neutral"> = { pending_warehouse: "warn", pending_director: "info", approved: "success", partial_approved: "success", rejected: "danger", cancelled: "neutral" };
const PRIO_TONE: Record<string, "danger" | "warn" | "neutral"> = { urgent: "danger", high: "warn", normal: "neutral", low: "neutral" };
const UNIT_KEY = "hyper_prd_last_unit";
const lastUnit = () => {
  try {
    const u = localStorage.getItem(UNIT_KEY);
    return u && (REQUEST_UNITS as readonly string[]).includes(u) ? u : "piece";
  } catch { return "piece"; }
};

/** طلبات الإنتاج: إنشاء الطلب، قرار المخزن، قرار الإدارة، والإلغاء. كل حالة معاها سبب بسيط («ليه الطلب واقف هنا؟»). */
export function ProductionRequests() {
  const role = staffUser()?.role ?? "";
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<{ row: RequestRow; kind: RequestAction } | null>(null);
  const list = useQuery((signal) => api.get<RequestRow[]>("/production-requests", { signal }), []);
  const all = Array.isArray(list.data) ? list.data : [];
  const rows = filter ? all.filter((r) => r.status === filter) : all;
  const counts = countByStatus(all);

  const columns: Column<RequestRow>[] = [
    { key: "no", header: t("prd.req.col.no"), cell: (r) => <strong>{r.requestNumber}</strong>, mobile: "title" },
    { key: "product", header: t("prd.req.col.product"), cell: (r) => r.productName },
    { key: "qty", header: t("prd.req.col.qty"), cell: (r) => `${formatNumber(Number(r.requestedQty))} ${unitLabel(r.unit)}`, numeric: true },
    { key: "prio", header: t("prd.req.col.priority"), cell: (r) => <StatusPill tone={PRIO_TONE[r.priority] ?? "neutral"}>{prioLabel(r.priority)}</StatusPill>, mobile: "hide" },
    {
      key: "status",
      header: t("prd.req.col.status"),
      cell: (r) => (
        <div class="prd-status">
          <StatusPill tone={TONE[r.status] ?? "neutral"}>{statusLabel(r.status)}</StatusPill>
          <small class="prd-muted">{whyLabel(r.status)}</small>
          {r.workflowOrderNumber ? <small class="prd-muted">{t("prd.req.order", { no: r.workflowOrderNumber })}</small> : null}
        </div>
      ),
    },
    { key: "date", header: t("prd.req.col.date"), cell: (r) => formatDate(r.createdAt), mobile: "hide" },
    {
      key: "act",
      header: t("prd.req.col.action"),
      cell: (r) => (
        <div class="prd-actions">
          {requestActions(role, r.status).map((k) => (
            <Button key={k} size="sm" variant={k === "cancel" || k === "warehouse_reject" ? "secondary" : "primary"} onClick={() => setDialog({ row: r, kind: k })}>{t(`prd.act.${k}` as CopyKey)}</Button>
          ))}
        </div>
      ),
    },
  ];

  return (
    <>
      <div class="prd-stats">
        <Stat label={t("prd.req.stat.total")} value={formatNumber(all.length)} />
        <Stat label={t("prd.req.stat.pending_warehouse")} value={formatNumber(counts.pending_warehouse ?? 0)} tone="warn" />
        <Stat label={t("prd.req.stat.pending_director")} value={formatNumber(counts.pending_director ?? 0)} tone="brand" />
        <Stat label={t("prd.req.stat.done")} value={formatNumber((counts.approved ?? 0) + (counts.partial_approved ?? 0))} tone="success" />
      </div>
      <p class="prd-muted">{t("prd.req.flow")}</p>
      <div class="prd-toolbar">
        <Select
          aria-label={t("prd.req.col.status")}
          value={filter}
          options={[{ value: "", label: t("prd.req.filter.all") }, ...["pending_warehouse", "pending_director", "approved", "partial_approved", "rejected", "cancelled"].map((s) => ({ value: s, label: statusLabel(s) }))]}
          onChange={(e) => setFilter(val(e))}
        />
        {canCreateRequest(role) ? <Button icon={Plus} onClick={() => setCreating(true)}>{t("prd.req.new")}</Button> : null}
      </div>
      {list.error ? <InlineAlert tone="danger" title={t("prd.err")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>}>{list.error.message}</InlineAlert> : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("prd.req.caption")} loading={list.loading} empty={<EmptyState title={t("prd.req.empty")} compact />} />
      {creating ? <NewRequestDialog onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await list.refetch(); }} /> : null}
      {dialog ? <DecisionDialog row={dialog.row} kind={dialog.kind} onClose={() => setDialog(null)} onDone={async () => { setDialog(null); await list.refetch(); }} /> : null}
    </>
  );
}

const statusLabel = (s: string) => t(`prd.req.status.${s}` as CopyKey);
const whyLabel = (s: string) => t(`prd.req.why.${s}` as CopyKey);
const prioLabel = (p: string) => t(`prd.prio.${p}` as CopyKey);
const unitLabel = (u: string) => ((REQUEST_UNITS as readonly string[]).includes(u) ? t(`prd.unit.${u}` as CopyKey) : u);

function NewRequestDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const recipes = useQuery((signal) => api.get<Recipe[]>("/production-requests/recipes", { signal }), []);
  const list = Array.isArray(recipes.data) ? recipes.data : [];
  const [recipeId, setRecipeId] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState(lastUnit);
  const [neededBy, setNeededBy] = useState("");
  const [priority, setPriority] = useState("normal");
  const [reason, setReason] = useState("");
  const recipe = list.find((r) => String(r.id) === recipeId);
  const qtyOk = isPositiveQty(qty);
  const valid = Boolean(recipe && qtyOk);

  const save = async () => {
    if (!recipe) return;
    const ok = await act.run(async () => {
      await api.post<unknown>("/production-requests", {
        bomRecipeId: recipe.id,
        productName: recipe.productName,
        requestedQty: qty.trim(),
        unit,
        neededBy: neededBy || undefined,
        priority,
        reason: reason.trim() || undefined,
      });
      return true;
    }, t("prd.new.done"));
    if (ok) {
      try { localStorage.setItem(UNIT_KEY, unit); } catch { /* التخزين اختياري */ }
      await onDone();
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("prd.new.title")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} disabled={!valid} onClick={() => void save()}>{t("prd.new.save")}</Button>
        </>
      }
    >
      <div class="prd-form">
        {recipes.error ? <InlineAlert tone="danger">{t("prd.new.recipesFail")}</InlineAlert> : null}
        <Field label={t("prd.new.recipe")} required hint={t("prd.new.recipeHint")}>
          <Select value={recipeId} options={[{ value: "", label: t("prd.new.recipePick") }, ...list.map((r) => ({ value: String(r.id), label: r.productCode ? `${r.productName} | ${r.productCode}` : r.productName }))]} onChange={(e) => setRecipeId(val(e))} />
        </Field>
        <Field label={t("prd.new.qty")} required error={qty && !qtyOk ? t("prd.new.qtyBad") : undefined}>
          <Input inputMode="decimal" value={qty} onInput={(e) => setQty(val(e))} />
        </Field>
        <Field label={t("prd.new.unit")} required>
          <Select value={unit} options={REQUEST_UNITS.map((u) => ({ value: u, label: unitLabel(u) }))} onChange={(e) => setUnit(val(e))} />
        </Field>
        <Field label={t("prd.new.priority")}>
          <Select value={priority} options={REQUEST_PRIORITIES.map((p) => ({ value: p, label: prioLabel(p) }))} onChange={(e) => setPriority(val(e))} />
        </Field>
        <Field label={t("prd.new.neededBy")}>
          <Input type="date" value={neededBy} onInput={(e) => setNeededBy(val(e))} />
        </Field>
        <Field label={t("prd.new.reason")}>
          <Textarea value={reason} onInput={(e) => setReason(val(e))} maxLength={300} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}

function DecisionDialog({ row, kind, onClose, onDone }: { row: RequestRow; kind: RequestAction; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const [qty, setQty] = useState("");
  const [comment, setComment] = useState("");
  const [action, setAction] = useState<DirectorAction>("approve");
  const needsQty = kind === "warehouse_partial" || (kind === "director" && action === "override");
  const qtyErr = kind === "warehouse_partial" ? partialQtyError(qty, row.requestedQty) : kind === "director" && action === "override" && !isPositiveQty(qty) ? "bad" : null;
  const commentErr = kind === "warehouse_reject" ? comment.trim().length < 3 : kind === "director" ? directorError(action, qty, comment) === "comment" : false;
  const valid = !qtyErr && !commentErr;
  const showComment = kind === "warehouse_reject" || kind === "director" || kind === "warehouse_partial";

  const send = async () => {
    const id = row.id;
    const ok = await act.run(async () => {
      if (kind === "cancel") await api.patch<unknown>(`/production-requests/${id}/cancel`, {});
      else if (kind === "director") await api.patch<unknown>(`/production-requests/${id}/director-action`, { action, overrideQty: action === "override" ? qty.trim() : undefined, comment: comment.trim() || undefined });
      else await api.patch<unknown>(`/production-requests/${id}/warehouse-action`, { action: kind === "warehouse_approve" ? "approve" : kind === "warehouse_partial" ? "partial" : "reject", approvedQty: kind === "warehouse_partial" ? qty.trim() : undefined, comment: comment.trim() || undefined });
      return true;
    }, kind === "cancel" ? t("prd.dec.cancelled") : t("prd.dec.done"));
    if (ok) await onDone();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${t(`prd.dec.${kind}.title` as CopyKey)} | ${row.requestNumber}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} disabled={!valid} onClick={() => void send()}>{t("prd.dec.send")}</Button>
        </>
      }
    >
      <div class="prd-form">
        <p class="prd-muted">{t(`prd.dec.${kind}.text` as CopyKey)}</p>
        <p><strong>{row.productName}</strong> | {formatNumber(Number(row.requestedQty))} {unitLabel(row.unit)}</p>
        {kind === "director" ? (
          <Field label={t("prd.dec.action")}>
            <Select value={action} options={(["approve", "override", "reject", "noted"] as const).map((a) => ({ value: a, label: t(`prd.dec.a.${a}` as CopyKey) }))} onChange={(e) => setAction(val(e) as DirectorAction)} />
          </Field>
        ) : null}
        {needsQty ? (
          <Field label={kind === "director" ? t("prd.dec.overrideQty") : t("prd.dec.qty")} required error={qty && qtyErr ? (qtyErr === "tooMuch" ? t("prd.dec.qtyTooMuch", { max: row.requestedQty }) : t("prd.dec.qtyBad")) : undefined}>
            <Input inputMode="decimal" value={qty} onInput={(e) => setQty(val(e))} />
          </Field>
        ) : null}
        {showComment ? (
          <Field label={t("prd.dec.comment")} required={kind === "warehouse_reject" || (kind === "director" && action === "reject")} error={comment && commentErr ? t("prd.dec.commentNeed") : undefined}>
            <Textarea value={comment} onInput={(e) => setComment(val(e))} maxLength={300} rows={2} />
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
