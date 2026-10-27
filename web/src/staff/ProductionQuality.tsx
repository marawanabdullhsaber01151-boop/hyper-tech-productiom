import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, Textarea, type Column } from "../design/components";
import { Plus, Search } from "../design/icons";
import { formatNumber, formatRelative } from "../lib/format";
import { NCR_DISPOSITIONS, NCR_QTY_RE, canCloseNcr, defectSuggestions, isPositiveQty, ncrOrderOk } from "./productionRules";

interface NcrRow {
  id: number;
  ncrNumber: string;
  workflowOrderId: number;
  orderNumber: string | null;
  productName: string | null;
  defectCode: string;
  affectedQty: string;
  disposition: string | null;
  status: string;
  rootCause: string | null;
  correctiveAction: string | null;
  createdAt: string;
}
interface OrderLookup { id: number; orderNumber: string; productName: string; workflowStatus: string }
interface TraceRow { id: number; lotNumber: string; traceType: string; itemCode: string | null; quantity: string | null; batchId: number; orderNumber: string | null; createdAt: string }

/** خاصية list مش في أنواع Input، فبتتمرر كده عشان تربط الحقل باقتراحات أكواد العيوب. */
const DEFECT_LIST: Record<string, string> = { list: "prd-defects" };
const val = (e: Event) => (e.target as HTMLInputElement).value;
const dispLabel = (d: string | null) => (d && (NCR_DISPOSITIONS as readonly string[]).includes(d) ? t(`prd.q.disp.${d}` as CopyKey) : "—");

/** حالات عدم المطابقة: فتح حالة على أمر إنتاج، وقفلها بسبب جذري وإجراء تصحيحي. */
export function ProductionQuality() {
  const role = staffUser()?.role ?? "";
  const [filter, setFilter] = useState("open");
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<NcrRow | null>(null);
  const list = useQuery((signal) => api.get<NcrRow[]>("/production-execution/ncrs", { signal }), []);
  const all = Array.isArray(list.data) ? list.data : [];
  const rows = filter ? all.filter((r) => r.status === filter) : all;
  const open = all.filter((r) => r.status !== "closed").length;

  const columns: Column<NcrRow>[] = [
    { key: "no", header: t("prd.q.col.no"), cell: (r) => <strong>{r.ncrNumber}</strong>, mobile: "title" },
    { key: "order", header: t("prd.q.col.order"), cell: (r) => (r.orderNumber ? `${r.orderNumber}${r.productName ? ` | ${r.productName}` : ""}` : "—") },
    { key: "defect", header: t("prd.q.col.defect"), cell: (r) => r.defectCode },
    { key: "qty", header: t("prd.q.col.qty"), cell: (r) => formatNumber(Number(r.affectedQty)), numeric: true },
    { key: "disp", header: t("prd.q.col.disposition"), cell: (r) => dispLabel(r.disposition), mobile: "hide" },
    {
      key: "status",
      header: t("prd.q.col.status"),
      cell: (r) => (
        <div class="prd-status">
          <StatusPill tone={r.status === "closed" ? "success" : "warn"}>{t(r.status === "closed" ? "prd.q.status.closed" : "prd.q.status.open")}</StatusPill>
          {r.status === "closed" && r.rootCause ? <small class="prd-muted">{t("prd.q.closedInfo", { root: r.rootCause, action: r.correctiveAction ?? "—" })}</small> : null}
        </div>
      ),
    },
    { key: "when", header: t("prd.q.col.when"), cell: (r) => formatRelative(r.createdAt), mobile: "hide" },
    {
      key: "act",
      header: t("prd.req.col.action"),
      cell: (r) => (r.status !== "closed" && canCloseNcr(role) ? <Button size="sm" onClick={() => setClosing(r)}>{t("prd.q.close")}</Button> : null),
    },
  ];

  return (
    <>
      <div class="prd-stats">
        <Stat label={t("prd.q.stat.open")} value={formatNumber(open)} tone={open ? "warn" : "success"} />
        <Stat label={t("prd.q.stat.closed")} value={formatNumber(all.length - open)} />
      </div>
      <div class="prd-toolbar">
        <Select aria-label={t("prd.q.col.status")} value={filter} options={[{ value: "open", label: t("prd.q.filter.open") }, { value: "closed", label: t("prd.q.filter.closed") }, { value: "", label: t("prd.q.filter.all") }]} onChange={(e) => setFilter(val(e))} />
        <Button icon={Plus} onClick={() => setCreating(true)}>{t("prd.q.new")}</Button>
      </div>
      {list.error ? <InlineAlert tone="danger" title={t("prd.err")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>}>{list.error.message}</InlineAlert> : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("prd.q.caption")} loading={list.loading} empty={<EmptyState title={t("prd.q.empty")} compact />} />
      {creating ? <NewNcrDialog suggestions={defectSuggestions(all)} onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await list.refetch(); }} /> : null}
      {closing ? <CloseNcrDialog row={closing} onClose={() => setClosing(null)} onDone={async () => { setClosing(null); await list.refetch(); }} /> : null}
    </>
  );
}

function NewNcrDialog({ suggestions, onClose, onDone }: { suggestions: string[]; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const orders = useQuery((signal) => api.get<OrderLookup[]>("/production-workflow", { signal }), []);
  const list = (Array.isArray(orders.data) ? orders.data : []).filter((o) => ncrOrderOk(o.workflowStatus));
  const [orderId, setOrderId] = useState("");
  const [defect, setDefect] = useState("");
  const [qty, setQty] = useState("");
  const [disposition, setDisposition] = useState("hold");
  const qtyOk = isPositiveQty(qty, NCR_QTY_RE);
  const valid = Boolean(orderId && defect.trim() && qtyOk);

  const save = async () => {
    const ok = await act.run(async () => {
      await api.post<unknown>("/production-execution/ncrs", { workflowOrderId: Number(orderId), defectCode: defect.trim(), affectedQty: qty.trim(), disposition, evidence: [] });
      return true;
    }, t("prd.q.new.done"));
    if (ok) await onDone();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("prd.q.new")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} disabled={!valid} onClick={() => void save()}>{t("prd.q.new.save")}</Button>
        </>
      }
    >
      <div class="prd-form">
        <Field label={t("prd.q.new.order")} required hint={list.length || orders.loading ? t("prd.q.new.orderHint") : t("prd.q.new.noOrders")}>
          <Select value={orderId} options={[{ value: "", label: t("prd.q.new.orderPick") }, ...list.map((o) => ({ value: String(o.id), label: `${o.orderNumber} | ${o.productName}` }))]} onChange={(e) => setOrderId(val(e))} />
        </Field>
        <Field label={t("prd.q.new.defect")} required hint={t("prd.q.new.defectHint")}>
          <Input value={defect} {...DEFECT_LIST} maxLength={80} onInput={(e) => setDefect(val(e))} />
          <datalist id="prd-defects">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label={t("prd.q.new.qty")} required error={qty && !qtyOk ? t("prd.q.new.qtyBad") : undefined}>
          <Input inputMode="decimal" value={qty} onInput={(e) => setQty(val(e))} />
        </Field>
        <Field label={t("prd.q.new.disposition")}>
          <Select value={disposition} options={NCR_DISPOSITIONS.map((d) => ({ value: d, label: dispLabel(d) }))} onChange={(e) => setDisposition(val(e))} />
        </Field>
        <InlineAlert tone="info">{t("prd.q.new.hint")}</InlineAlert>
      </div>
    </Dialog>
  );
}

function CloseNcrDialog({ row, onClose, onDone }: { row: NcrRow; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const [root, setRoot] = useState("");
  const [action, setAction] = useState("");
  const [disposition, setDisposition] = useState(row.disposition ?? "hold");
  const rootErr = root.trim().length < 3;
  const actErr = action.trim().length < 3;

  const save = async () => {
    const id = row.id;
    const ok = await act.run(async () => {
      await api.patch<unknown>(`/production-execution/ncrs/${id}/close`, { rootCause: root.trim(), correctiveAction: action.trim(), disposition });
      return true;
    }, t("prd.q.close.done"));
    if (ok) await onDone();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("prd.q.close.title", { no: row.ncrNumber })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} disabled={rootErr || actErr} onClick={() => void save()}>{t("prd.q.close.save")}</Button>
        </>
      }
    >
      <div class="prd-form">
        <p class="prd-muted">{t("prd.q.close.text")}</p>
        <Field label={t("prd.q.close.root")} required error={root && rootErr ? t("prd.q.close.need") : undefined}>
          <Textarea value={root} onInput={(e) => setRoot(val(e))} maxLength={1000} rows={2} />
        </Field>
        <Field label={t("prd.q.close.action")} required error={action && actErr ? t("prd.q.close.need") : undefined}>
          <Textarea value={action} onInput={(e) => setAction(val(e))} maxLength={1000} rows={2} />
        </Field>
        <Field label={t("prd.q.col.disposition")}>
          <Select value={disposition} options={NCR_DISPOSITIONS.map((d) => ({ value: d, label: dispLabel(d) }))} onChange={(e) => setDisposition(val(e))} />
        </Field>
      </div>
    </Dialog>
  );
}

/** تتبع التشغيلة: رقم الـ Lot بيجيب كل سجلاته (دخلت فين، طلعت فين). */
export function ProductionTrace() {
  const [lot, setLot] = useState("");
  const [searched, setSearched] = useState("");
  const [rows, setRows] = useState<TraceRow[] | null>(null);
  const act = useAct();

  const search = async () => {
    const q = lot.trim();
    if (!q) return;
    const r = await act.run(() => api.get<TraceRow[]>(`/production-execution/traceability/${encodeURIComponent(q)}`), undefined);
    if (r) {
      setRows(Array.isArray(r) ? r : []);
      setSearched(q);
    }
  };

  const columns: Column<TraceRow>[] = [
    { key: "type", header: t("prd.tr.col.type"), cell: (r) => <strong>{t(`prd.tr.type.${r.traceType}` as CopyKey)}</strong>, mobile: "title" },
    { key: "item", header: t("prd.tr.col.item"), cell: (r) => r.itemCode ?? "—" },
    { key: "qty", header: t("prd.tr.col.qty"), cell: (r) => (r.quantity ? formatNumber(Number(r.quantity)) : "—"), numeric: true },
    { key: "order", header: t("prd.tr.col.order"), cell: (r) => r.orderNumber ?? "—", mobile: "hide" },
    { key: "when", header: t("prd.tr.col.when"), cell: (r) => formatRelative(r.createdAt), mobile: "hide" },
  ];

  return (
    <>
      <p class="prd-muted">{t("prd.tr.sub")}</p>
      <form class="prd-toolbar" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <Input aria-label={t("prd.tr.input")} placeholder={t("prd.tr.input")} value={lot} maxLength={100} onInput={(e) => setLot(val(e))} />
        <Button type="submit" icon={Search} loading={act.busy} disabled={!lot.trim()}>{t("prd.tr.search")}</Button>
      </form>
      {rows === null ? <EmptyState title={t("prd.tr.empty")} compact /> : <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={`${t("prd.tr.caption")} ${searched}`} empty={<EmptyState title={t("prd.tr.none")} compact />} />}
    </>
  );
}
