import { useMemo, useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, ConfirmDialog, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, StatusPill, Textarea, type Column } from "../design/components";
import { Check, Plus } from "../design/icons";
import { formatNumber, formatRelative } from "../lib/format";
import { QUANTITY_RE, canReceiveTransfer, creatableDirections, newIdempotencyKey, stockNote, type TransferDirection } from "./transferRules";

interface TransferRow {
  id: number;
  workflowOrderId: number;
  orderNumber: string | null;
  productName: string | null;
  direction: string;
  itemName: string | null;
  quantity: string;
  status: string;
  notes: string | null;
  preparedAt: string;
  receivedAt: string | null;
}
interface OrderLookup { id: number; orderNumber: string; productName: string }
interface ItemLookup { id: number; code: string | null; name: string }

const val = (e: Event) => (e.target as HTMLInputElement).value;
const dirLabel = (d: string) => t(`opc.tr.dir.${d}` as CopyKey);

/** التحويلات: حركة الخامات بين المخزن والتشغيل والإنتاج، بقايمة واضحة واستلام بزر واحد. */
export function OperationsTransfers({ onChanged }: { onChanged: () => void }) {
  const act = useAct();
  const role = staffUser()?.role ?? "";
  const [status, setStatus] = useState("pending");
  const [target, setTarget] = useState<TransferRow | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useQuery((signal) => api.get<TransferRow[]>("/operations-control/transfers", { signal, query: status ? { status } : {} }), [status]);
  const rows = Array.isArray(list.data) ? list.data : [];
  const directions = creatableDirections(role);

  const receive = async () => {
    if (!target) return;
    const row = target;
    const ok = await act.run(async () => {
      await api.patch<unknown>(`/operations-control/transfers/${row.id}/receive`, {});
      return true;
    }, t("opc.tr.received", { no: String(row.id) }));
    setTarget(null);
    if (ok) {
      await list.refetch();
      onChanged();
    }
  };

  const columns: Column<TransferRow>[] = [
    { key: "dir", header: t("opc.tr.col.dir"), cell: (r) => <strong>{dirLabel(r.direction)}</strong>, mobile: "title" },
    { key: "order", header: t("opc.col.order"), cell: (r) => r.orderNumber ?? "—" },
    { key: "item", header: t("opc.col.material"), cell: (r) => r.itemName ?? "—", mobile: "hide" },
    { key: "qty", header: t("opc.col.qty"), cell: (r) => formatNumber(Number(r.quantity)), numeric: true },
    { key: "age", header: t("opc.tr.col.when"), cell: (r) => formatRelative(r.preparedAt), mobile: "hide" },
    {
      key: "act",
      header: t("opc.col.action"),
      cell: (r) =>
        r.status === "received" ? (
          <StatusPill tone="success">{t("opc.tr.status.received")}</StatusPill>
        ) : canReceiveTransfer(role, r.direction) ? (
          <Button size="sm" icon={Check} onClick={(e) => { e.stopPropagation(); setTarget(r); }}>{t("opc.tr.receive")}</Button>
        ) : (
          <StatusPill tone="warn">{t("opc.tr.status.pending")}</StatusPill>
        ),
    },
  ];

  return (
    <>
      <div class="opc-toolbar">
        <Select
          aria-label={t("opc.col.status")}
          value={status}
          options={[
            { value: "pending", label: t("opc.tr.status.pending") },
            { value: "received", label: t("opc.tr.status.received") },
            { value: "", label: t("opc.tr.status.all") },
          ]}
          onChange={(e) => setStatus(val(e))}
        />
        {directions.length ? <Button icon={Plus} onClick={() => setCreating(true)}>{t("opc.tr.new")}</Button> : null}
      </div>
      <p class="opc-muted">{t("opc.tr.note")}</p>
      {list.error ? <InlineAlert tone="danger" title={t("opc.err")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>}>{list.error.message}</InlineAlert> : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("opc.tr.caption")} loading={list.loading} empty={<EmptyState title={t("opc.tr.empty")} compact />} />
      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={() => void receive()}
        title={t("opc.tr.confirmTitle")}
        description={target ? `${dirLabel(target.direction)} | ${formatNumber(Number(target.quantity))} ${target.itemName ?? ""} | ${t(`opc.tr.stock.${stockNote(target.direction)}` as CopyKey)}` : undefined}
        confirmLabel={t("opc.tr.receive")}
        loading={act.busy}
      />
      {creating ? (
        <NewTransferDialog
          directions={directions}
          onClose={() => setCreating(false)}
          onDone={async () => {
            setCreating(false);
            await list.refetch();
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function NewTransferDialog({ directions, onClose, onDone }: { directions: readonly TransferDirection[]; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const orders = useQuery((signal) => api.get<OrderLookup[]>("/operations-control/lookups/production-orders", { signal }), []);
  const items = useQuery((signal) => api.get<ItemLookup[]>("/operations-control/lookups/inventory-items", { signal }), []);
  const [direction, setDirection] = useState<string>(directions[0] ?? "");
  const [orderId, setOrderId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  // مفتاح واحد للمحاولة: لو الشبكة وقعت والمستخدم ضغط تاني، السيرفر يرفض التكرار بدل ما يسجّل حركتين.
  const key = useMemo(() => newIdempotencyKey(), []);
  const orderList = Array.isArray(orders.data) ? orders.data : [];
  const itemList = Array.isArray(items.data) ? items.data : [];
  const qtyOk = QUANTITY_RE.test(qty.trim()) && Number(qty) > 0;
  const valid = Boolean(direction && orderId && qtyOk);

  const save = async () => {
    const ok = await act.run(async () => {
      await api.post<unknown>("/operations-control/transfers", {
        workflowOrderId: Number(orderId),
        direction,
        inventoryItemId: itemId ? Number(itemId) : undefined,
        quantity: qty.trim(),
        idempotencyKey: key,
        notes: notes.trim() || undefined,
      });
      return true;
    }, t("opc.tr.created"));
    if (ok) await onDone();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("opc.tr.new")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} disabled={!valid} onClick={() => void save()}>{t("opc.tr.save")}</Button>
        </>
      }
    >
      <div class="opc-form">
        <Field label={t("opc.tr.col.dir")} required>
          <Select value={direction} options={directions.map((d) => ({ value: d, label: dirLabel(d) }))} onChange={(e) => setDirection(val(e))} />
        </Field>
        <Field label={t("opc.col.order")} required>
          <Select value={orderId} options={[{ value: "", label: t("opc.tr.pick") }, ...orderList.map((o) => ({ value: String(o.id), label: `${o.orderNumber} | ${o.productName}` }))]} onChange={(e) => setOrderId(val(e))} />
        </Field>
        <Field label={t("opc.col.material")} hint={t("opc.tr.itemHint")}>
          <Select value={itemId} options={[{ value: "", label: t("opc.tr.noItem") }, ...itemList.map((i) => ({ value: String(i.id), label: i.code ? `${i.code} | ${i.name}` : i.name }))]} onChange={(e) => setItemId(val(e))} />
        </Field>
        <Field label={t("opc.col.qty")} required hint={t("opc.tr.qtyHint")} error={qty && !qtyOk ? t("opc.tr.qtyBad") : undefined}>
          <Input inputMode="decimal" value={qty} onInput={(e) => setQty(val(e))} />
        </Field>
        <Field label={t("opc.tr.notes")}>
          <Textarea value={notes} onInput={(e) => setNotes(val(e))} maxLength={300} />
        </Field>
        {direction ? <InlineAlert tone="info">{t(`opc.tr.stock.${stockNote(direction)}` as CopyKey)}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}
