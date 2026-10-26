import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Dialog, Field, InlineAlert, Input, Select, Skeleton, StatusPill, Textarea } from "../design/components";
import { Plus } from "../design/icons";
import { formatMoney, formatNumber } from "../lib/format";

interface CostSummary {
  total: number;
  byType: Record<string, number>;
  entries: Array<{ id: number; costType: string; amount: string; note: string | null; status: string }>;
}
interface Batch {
  id: number;
  batchNumber: string;
  plannedQty: string;
  producedQty: string;
  acceptedQty: string;
  stage: string;
  status: string;
}

const COST_TYPES = ["material", "labor", "machine", "energy", "overhead", "rework", "scrap"] as const;
const val = (e: Event) => (e.target as HTMLInputElement).value;
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const QTY_RE = /^\d+(\.\d{1,3})?$/;

/** تكلفة أمر الإنتاج ودفعاته: بيتحمّل عند الطلب، ومنه تسجّل تكلفة يدوية أو تفتح دفعة. */
export function OrderCost({ orderId }: { orderId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="opc-events">
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? t("opc.co.hide") : t("opc.co.show")}</Button>
      {open ? <CostPanel orderId={orderId} /> : null}
    </div>
  );
}

function CostPanel({ orderId }: { orderId: number }) {
  const cost = useQuery((signal) => api.get<CostSummary>(`/operations/orders/${orderId}/cost`, { signal }), [orderId]);
  const batches = useQuery((signal) => api.get<Batch[]>(`/operations/orders/${orderId}/batches`, { signal }), [orderId]);
  const [dlg, setDlg] = useState<null | "cost" | "batch">(null);
  const list = Array.isArray(batches.data) ? batches.data : [];
  const c = cost.data;
  const refresh = async () => {
    setDlg(null);
    await Promise.all([cost.refetch(), batches.refetch()]);
  };
  if (cost.loading || batches.loading) return <Skeleton height={48} />;
  if (cost.error) return <InlineAlert tone="danger" title={t("opc.err")}>{cost.error.message}</InlineAlert>;
  return (
    <div class="opc-stack">
      <div class="opc-hrow">
        <strong>{t("opc.co.total", { v: formatMoney(c?.total ?? 0) })}</strong>
        {Object.entries(c?.byType ?? {}).map(([k, v]) => (
          <StatusPill key={k} tone="neutral">{t(`opc.co.type.${k}` as CopyKey)}: {formatMoney(v)}</StatusPill>
        ))}
      </div>
      {list.length ? (
        <ul class="opc-lines">
          {list.map((b) => (
            <li key={b.id}>
              <strong>{b.batchNumber}</strong>
              <span class="opc-muted">{t("opc.co.batch", { p: formatNumber(Number(b.producedQty)), n: formatNumber(Number(b.plannedQty)) })}</span>
              <StatusPill tone={b.status === "open" ? "warn" : "success"}>{b.status}</StatusPill>
            </li>
          ))}
        </ul>
      ) : <p class="opc-muted">{t("opc.co.noBatches")}</p>}
      <div class="opc-hrow">
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setDlg("cost")}>{t("opc.co.add")}</Button>
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setDlg("batch")}>{t("opc.co.newBatch")}</Button>
      </div>
      {dlg === "cost" ? <CostDialog orderId={orderId} onClose={() => setDlg(null)} onDone={refresh} /> : null}
      {dlg === "batch" ? <BatchDialog orderId={orderId} onClose={() => setDlg(null)} onDone={refresh} /> : null}
    </div>
  );
}

function CostDialog({ orderId, onClose, onDone }: { orderId: number; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const [type, setType] = useState<string>("labor");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const valid = AMOUNT_RE.test(amount.trim()) && Number(amount) > 0;
  const save = async () => {
    const ok = await act.run(async () => {
      await api.post<unknown>("/operations/cost-entries", { workflowOrderId: orderId, costType: type, amount: amount.trim(), sourceType: "manual", note: note.trim() || undefined });
      return true;
    }, t("opc.co.added"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("opc.co.add")} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={!valid} onClick={() => void save()}>{t("opc.co.save")}</Button></>}>
      <div class="opc-form">
        <Field label={t("opc.co.f.type")} required>
          <Select value={type} options={COST_TYPES.map((k) => ({ value: k, label: t(`opc.co.type.${k}` as CopyKey) }))} onChange={(e) => setType(val(e))} />
        </Field>
        <Field label={t("opc.co.f.amount")} required hint={t("opc.co.f.amountHint")} error={amount && !valid ? t("opc.tr.qtyBad") : undefined}>
          <Input inputMode="decimal" value={amount} onInput={(e) => setAmount(val(e))} />
        </Field>
        <Field label={t("opc.tr.notes")}>
          <Textarea value={note} onInput={(e) => setNote(val(e))} maxLength={300} />
        </Field>
        <InlineAlert tone="info">{t("opc.co.approvalNote")}</InlineAlert>
      </div>
    </Dialog>
  );
}

function BatchDialog({ orderId, onClose, onDone }: { orderId: number; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const [qty, setQty] = useState("");
  const valid = QTY_RE.test(qty.trim()) && Number(qty) > 0;
  const save = async () => {
    const ok = await act.run(async () => {
      await api.post<unknown>("/operations/batches", { workflowOrderId: orderId, plannedQty: qty.trim() });
      return true;
    }, t("opc.co.batchAdded"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("opc.co.newBatch")} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={!valid} onClick={() => void save()}>{t("opc.co.saveBatch")}</Button></>}>
      <div class="opc-form">
        <Field label={t("opc.co.f.planned")} required hint={t("opc.tr.qtyHint")} error={qty && !valid ? t("opc.tr.qtyBad") : undefined}>
          <Input inputMode="decimal" value={qty} onInput={(e) => setQty(val(e))} />
        </Field>
      </div>
    </Dialog>
  );
}
