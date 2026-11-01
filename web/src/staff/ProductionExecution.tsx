import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, StatusPill, Textarea, type Column } from "../design/components";
import { Plus } from "../design/icons";
import { formatNumber } from "../lib/format";
import { DOWNTIME_REASONS, EXEC_QTY_RE, batchBalance, canConfirmBatch, canExecuteBatch, closeBlockReason, confirmError, confirmPayload, downtimeError, downtimePayload, type BatchLike } from "./executionCore";
import { ncrOrderOk } from "./productionRules";

export interface ExecBatch extends BatchLike {
  id: number;
  workflowOrderId: number;
  batchNumber: string;
}
interface OrderLookup { id: number; orderNumber: string; productName: string; workflowStatus: string }
interface Downtime { id: number; reasonCode: string; minutes: number; notes: string | null; createdAt: string }
interface Stage { key: string; shortName: string; orderCount: number }
interface Cycle { stages: Stage[] }

const val = (e: Event) => (e.target as HTMLInputElement).value;
const fmt = (n: number) => formatNumber(n);
const reasonLabel = (c: string) => ((DOWNTIME_REASONS as readonly string[]).includes(c) ? t(`prd.ex.dt.reason.${c}` as CopyKey) : c);
const statusTone = (s: string) => (s === "completed" ? "success" : s === "in_progress" ? "info" : "neutral");
const statusLabel = (s: string) => (["open", "in_progress", "completed"].includes(s) ? t(`prd.ex.status.${s}` as CopyKey) : s);

/** شريط مراحل الدورة. بيختفي بهدوء لو الدور مالوش صلاحية القراءة (السيرفر يرد 403). */
function CycleStrip() {
  const q = useQuery((signal) => api.get<Cycle>("/production-cycle/dashboard", { signal }), []);
  const stages = q.data && Array.isArray(q.data.stages) ? q.data.stages.filter((s) => s.orderCount > 0) : [];
  if (!stages.length) return null;
  return (
    <section aria-label={t("prd.ex.stages")}>
      <p class="prd-muted">{t("prd.ex.stages")}</p>
      <div class="prd-toolbar">
        {stages.map((s) => <StatusPill key={s.key} tone="neutral">{t("prd.ex.stage", { name: s.shortName, n: fmt(s.orderCount) })}</StatusPill>)}
      </div>
    </section>
  );
}

/** قايمة الأوامر اللي ينفع تتنفذ عليها دفعات (نفس شرط فتح حالة عدم المطابقة). */
export function useExecutableOrders() {
  const orders = useQuery((signal) => api.get<OrderLookup[]>("/production-workflow", { signal }), []);
  return { loading: orders.loading, list: (Array.isArray(orders.data) ? orders.data : []).filter((o) => ncrOrderOk(o.workflowStatus)) };
}

/** تنفيذ الإنتاج: دفعات الأمر، تأكيد العمليات، التوقفات، وقفل الدفعة بعد موازنة الكميات. */
export function ProductionExecution() {
  const role = staffUser()?.role ?? "";
  const canExec = canExecuteBatch(role);
  const { list: orders, loading: ordersLoading } = useExecutableOrders();
  const [orderId, setOrderId] = useState("");
  const batches = useQuery((signal) => (orderId ? api.get<ExecBatch[]>(`/operations/orders/${orderId}/batches`, { signal }) : Promise.resolve([] as ExecBatch[])), [orderId]);
  const rows = Array.isArray(batches.data) ? batches.data : [];
  const [dlg, setDlg] = useState<null | { kind: "confirm" | "downtime" | "close"; batch: ExecBatch } | { kind: "new" }>(null);
  const order = orders.find((o) => String(o.id) === orderId);
  const done = async () => { setDlg(null); await batches.refetch(); };

  const columns: Column<ExecBatch>[] = [
    { key: "no", header: t("prd.ex.col.batch"), cell: (b) => <strong>{b.batchNumber}</strong>, mobile: "title" },
    { key: "planned", header: t("prd.ex.col.planned"), cell: (b) => fmt(Number(b.plannedQty)), numeric: true, mobile: "hide" },
    { key: "produced", header: t("prd.ex.col.produced"), cell: (b) => fmt(Number(b.producedQty)), numeric: true },
    { key: "accepted", header: t("prd.ex.col.accepted"), cell: (b) => <span title={t("prd.ex.progress", { pct: batchBalance(b).progressPct })}>{fmt(Number(b.acceptedQty))}</span>, numeric: true },
    { key: "rework", header: t("prd.ex.col.rework"), cell: (b) => fmt(Number(b.reworkQty)), numeric: true, mobile: "hide" },
    { key: "scrap", header: t("prd.ex.col.scrap"), cell: (b) => fmt(Number(b.scrapQty)), numeric: true, mobile: "hide" },
    { key: "status", header: t("prd.ex.col.status"), cell: (b) => <StatusPill tone={statusTone(b.status)}>{statusLabel(b.status)}</StatusPill> },
    {
      key: "act",
      header: t("prd.req.col.action"),
      cell: (b) => (
        <div class="prd-toolbar">
          {canExec && canConfirmBatch(b) ? <Button size="sm" onClick={() => setDlg({ kind: "confirm", batch: b })}>{t("prd.ex.confirm")}</Button> : null}
          <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "downtime", batch: b })}>{t("prd.ex.downtime")}</Button>
          {canExec && b.status !== "completed" ? <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "close", batch: b })}>{t("prd.ex.close")}</Button> : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <p class="prd-muted">{t("prd.ex.sub")}</p>
      <CycleStrip />
      <div class="prd-toolbar">
        <Select aria-label={t("prd.ex.order")} value={orderId} options={[{ value: "", label: t("prd.ex.orderPick") }, ...orders.map((o) => ({ value: String(o.id), label: `${o.orderNumber} | ${o.productName}` }))]} onChange={(e) => setOrderId(val(e))} />
        {canExec && orderId ? <Button icon={Plus} onClick={() => setDlg({ kind: "new" })}>{t("prd.ex.newBatch")}</Button> : null}
      </div>
      {!canExec ? <InlineAlert tone="info">{t("prd.ex.noExecute")}</InlineAlert> : null}
      {!ordersLoading && !orders.length ? <InlineAlert tone="info">{t("prd.ex.noOrders")}</InlineAlert> : null}
      {batches.error ? <InlineAlert tone="danger" title={t("prd.err")} action={<Button size="sm" variant="secondary" onClick={() => void batches.refetch()}>{t("common.retry")}</Button>}>{batches.error.message}</InlineAlert> : null}
      {orderId ? (
        <DataTable columns={columns} rows={rows} rowKey={(b) => b.id} caption={t("prd.ex.caption")} loading={batches.loading} empty={<EmptyState title={t("prd.ex.empty")} compact />} />
      ) : (
        <EmptyState title={t("prd.ex.pickFirst")} compact />
      )}
      {dlg?.kind === "confirm" ? <ConfirmDialog batch={dlg.batch} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.kind === "downtime" ? <DowntimeDialog batch={dlg.batch} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === "close" ? <CloseDialog batch={dlg.batch} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg?.kind === "new" && order ? <NewBatchDialog order={order} onClose={() => setDlg(null)} onDone={done} /> : null}
    </>
  );
}

type DoneFn = () => void | Promise<void>;

function ConfirmDialog({ batch, onClose, onDone }: { batch: ExecBatch; onClose: () => void; onDone: DoneFn }) {
  const act = useAct();
  const [f, setF] = useState({ operationNo: "", shiftCode: "", goodQty: "", scrapQty: "", reworkQty: "", notes: "" });
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: val(e) });
  const err = confirmError(f);
  const qtyBad = err === "qty";
  const save = async () => {
    const ok = await act.run(async () => {
      await api.patch<unknown>(`/production-execution/batches/${batch.id}/confirm`, confirmPayload(f));
      return true;
    }, t("prd.ex.cf.done"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("prd.ex.cf.title", { no: batch.batchNumber })} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={err !== null} onClick={() => void save()}>{t("prd.ex.cf.save")}</Button></>}>
      <div class="prd-form">
        <Field label={t("prd.ex.cf.op")} required error={f.operationNo && err === "operationNo" ? t("prd.ex.cf.opBad") : undefined}>
          <Input inputMode="numeric" value={f.operationNo} onInput={set("operationNo")} />
        </Field>
        <Field label={t("prd.ex.cf.shift")}><Input value={f.shiftCode} maxLength={40} onInput={set("shiftCode")} /></Field>
        <Field label={t("prd.ex.cf.good")} error={qtyBad ? t("prd.ex.cf.qtyBad") : undefined}><Input inputMode="decimal" value={f.goodQty} onInput={set("goodQty")} /></Field>
        <Field label={t("prd.ex.cf.scrap")}><Input inputMode="decimal" value={f.scrapQty} onInput={set("scrapQty")} /></Field>
        <Field label={t("prd.ex.cf.rework")}><Input inputMode="decimal" value={f.reworkQty} onInput={set("reworkQty")} /></Field>
        <Field label={t("prd.ex.cf.notes")}><Textarea value={f.notes} maxLength={1000} onInput={set("notes")} /></Field>
        {err === "empty" && f.operationNo ? <InlineAlert tone="warn">{t("prd.ex.cf.empty")}</InlineAlert> : null}
        <InlineAlert tone="info">{t("prd.ex.cf.hint")}</InlineAlert>
      </div>
    </Dialog>
  );
}

function DowntimeDialog({ batch, onClose }: { batch: ExecBatch; onClose: () => void }) {
  const act = useAct();
  const history = useQuery((signal) => api.get<Downtime[]>(`/production-execution/batches/${batch.id}/downtimes`, { signal }), [batch.id]);
  const list = Array.isArray(history.data) ? history.data : [];
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const err = downtimeError(reason, minutes);
  const save = async () => {
    const ok = await act.run(async () => {
      await api.post<unknown>(`/production-execution/batches/${batch.id}/downtimes`, downtimePayload(reason, minutes, notes));
      return true;
    }, t("prd.ex.dt.done"));
    if (ok) {
      setReason(""); setMinutes(""); setNotes("");
      await history.refetch();
    }
  };
  const total = list.reduce((s, d) => s + d.minutes, 0);
  return (
    <Dialog open onClose={onClose} title={t("prd.ex.dt.title", { no: batch.batchNumber })} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={err !== null} onClick={() => void save()}>{t("prd.ex.dt.save")}</Button></>}>
      <div class="prd-form">
        <Field label={t("prd.ex.dt.reason")} required>
          <Select value={reason} options={[{ value: "", label: t("prd.ex.dt.reasonPick") }, ...DOWNTIME_REASONS.map((r) => ({ value: r, label: reasonLabel(r) }))]} onChange={(e) => setReason(val(e))} />
        </Field>
        <Field label={t("prd.ex.dt.minutes")} required error={minutes && err === "minutes" ? t("prd.ex.dt.minutesBad") : undefined}>
          <Input inputMode="numeric" value={minutes} onInput={(e) => setMinutes(val(e))} />
        </Field>
        <Field label={t("prd.ex.dt.notes")}><Textarea value={notes} maxLength={1000} onInput={(e) => setNotes(val(e))} /></Field>
        <section aria-label={t("prd.ex.dt.history")}>
          <strong>{t("prd.ex.dt.history")}</strong>
          {list.length ? (
            <>
              <ul>{list.map((d) => <li key={d.id}>{t("prd.ex.dt.row", { reason: reasonLabel(d.reasonCode), min: fmt(d.minutes) })}{d.notes ? ` | ${d.notes}` : ""}</li>)}</ul>
              <p class="prd-muted">{t("prd.ex.dt.total", { min: fmt(total) })}</p>
            </>
          ) : <p class="prd-muted">{history.loading ? "…" : t("prd.ex.dt.none")}</p>}
        </section>
      </div>
    </Dialog>
  );
}

function CloseDialog({ batch, onClose, onDone }: { batch: ExecBatch; onClose: () => void; onDone: DoneFn }) {
  const act = useAct();
  const bal = batchBalance(batch);
  const block = closeBlockReason(batch);
  const short = !block && Number(batch.acceptedQty) + 0.0005 < Number(batch.plannedQty);
  const save = async () => {
    const ok = await act.run(async () => {
      await api.patch<unknown>(`/production-execution/batches/${batch.id}/close`, {});
      return true;
    }, t("prd.ex.cl.done"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("prd.ex.cl.title", { no: batch.batchNumber })} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={block !== null} onClick={() => void save()}>{t("prd.ex.cl.confirm")}</Button></>}>
      <div class="prd-form">
        <p>{t("prd.ex.cl.summary", { produced: fmt(bal.produced), accepted: fmt(Number(batch.acceptedQty)), rework: fmt(Number(batch.reworkQty)), scrap: fmt(Number(batch.scrapQty)) })}</p>
        {block ? <InlineAlert tone="warn">{t(`prd.ex.block.${block}` as CopyKey, { gap: fmt(bal.gap) })}</InlineAlert> : <InlineAlert tone="success">{t("prd.ex.cl.ok")}</InlineAlert>}
        {short ? <InlineAlert tone="warn">{t("prd.ex.cl.short", { accepted: fmt(Number(batch.acceptedQty)), planned: fmt(Number(batch.plannedQty)) })}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}

function NewBatchDialog({ order, onClose, onDone }: { order: OrderLookup; onClose: () => void; onDone: DoneFn }) {
  const act = useAct();
  const [qty, setQty] = useState("");
  const valid = EXEC_QTY_RE.test(qty.trim()) && Number(qty) > 0;
  const save = async () => {
    const ok = await act.run(async () => {
      await api.post<unknown>("/operations/batches", { workflowOrderId: order.id, plannedQty: qty.trim() });
      return true;
    }, t("prd.ex.nb.done"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("prd.ex.nb.title", { no: order.orderNumber })} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={!valid} onClick={() => void save()}>{t("prd.ex.nb.save")}</Button></>}>
      <div class="prd-form">
        <Field label={t("prd.ex.nb.planned")} required error={qty && !valid ? t("prd.ex.nb.plannedBad") : undefined}>
          <Input inputMode="decimal" value={qty} onInput={(e) => setQty(val(e))} />
        </Field>
      </div>
    </Dialog>
  );
}
