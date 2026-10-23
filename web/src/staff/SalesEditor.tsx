import { useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { useAct } from "../admin/act";
import { useQuery } from "../api/hooks";
import { t } from "../copy";
import { Button, Dialog, Field, InlineAlert, Input, Select, Textarea, useToast, type Option } from "../design/components";
import { Package, Pencil, Trash } from "../design/icons";
import { formatMoney, formatNumber } from "../lib/format";
import { draftTotal, suggestOrderNumber, todayStr, toItemsPayload, validateDraft, type DraftRow, type RowError, type SalesOrder } from "./salesCore";

export interface InventoryOpt {
  id: number;
  name: string;
  unit?: string | null;
  availableQty?: string;
  unitPrice?: string;
}
export interface CustomerOpt {
  id: number;
  name: string;
}

const rowErrKey = {
  pick: "sales.ed.err.pick",
  desc: "sales.ed.err.desc",
  qty: "sales.ed.err.qty",
  price: "sales.ed.err.price",
} as const;

function rowsFromOrder(o: SalesOrder): DraftRow[] {
  return (o.items ?? []).map((i) =>
    i.inventoryItemId
      ? { kind: "stock", inventoryItemId: i.inventoryItemId, description: i.description, qty: String(Number(i.qty)), price: "", catalogPrice: i.unitPrice }
      : { kind: "manual", inventoryItemId: null, description: i.description, qty: String(Number(i.qty)), price: String(Number(i.unitPrice)) },
  );
}

/** نافذة إنشاء/تعديل فاتورة أوفلاين. بنود المخزون بتاخد سعرها من المخزون (السيرفر هو المرجع). */
export function SalesEditor({ order, customers, onClose, onSaved }: { order?: SalesOrder; customers: CustomerOpt[]; onClose: () => void; onSaved: () => void }) {
  const editing = !!order;
  const inv = useQuery((signal) => api.get<InventoryOpt[]>("/inventory", { signal }), []);
  const act = useAct();
  const toast = useToast();
  const [number, setNumber] = useState(order?.orderNumber ?? suggestOrderNumber());
  const [contactId, setContactId] = useState(order?.contactId ? String(order.contactId) : "");
  const [date, setDate] = useState(order?.date ?? todayStr());
  const [due, setDue] = useState(order?.dueDate ?? "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [rows, setRows] = useState<DraftRow[]>(order ? rowsFromOrder(order) : []);
  const [tried, setTried] = useState(false);

  const draft = { orderNumber: number, date, dueDate: due, rows };
  const v = useMemo(() => validateDraft(draft, !editing), [number, date, due, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = useMemo(() => draftTotal(rows), [rows]);
  const invById = useMemo(() => new Map((inv.data ?? []).map((i) => [i.id, i])), [inv.data]);
  const invOptions: Option[] = (inv.data ?? []).map((i) => ({ value: String(i.id), label: i.availableQty !== undefined ? `${i.name} — ${t("sales.ed.item.avail", { n: formatNumber(Number(i.availableQty)) })}` : i.name }));

  const patch = (k: number, p: Partial<DraftRow>) => setRows((rs) => rs.map((r, i) => (i === k ? { ...r, ...p } : r)));
  const pick = (k: number, idStr: string) => {
    const it = invById.get(Number(idStr));
    patch(k, it ? { inventoryItemId: it.id, description: it.name, catalogPrice: it.unitPrice ?? null } : { inventoryItemId: null, description: "", catalogPrice: null });
  };

  const save = async () => {
    setTried(true);
    if (!v.ok) return;
    const items = toItemsPayload(rows);
    const total = draftTotal(rows).total;
    const body = {
      ...(editing ? {} : { orderNumber: number.trim(), status: "draft", subtotal: total, total }),
      contactId: contactId ? Number(contactId) : null,
      date,
      dueDate: due || null,
      notes: notes.trim() || null,
      items,
    };
    const r = await act.run(() => (order ? api.patch<SalesOrder>(`/sales/${order.id}`, body) : api.post<SalesOrder>("/sales", body)));
    if (!r) return;
    toast({ tone: "success", message: editing ? t("sales.ed.updated") : t("sales.ed.created", { n: r.orderNumber ?? number }) });
    onSaved();
    onClose();
  };

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={editing ? t("sales.ed.title.edit", { n: order!.orderNumber }) : t("sales.ed.title.new")}
      description={editing ? t("sales.ed.desc.edit") : t("sales.ed.desc.new")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} onClick={() => void save()}>{t("sales.ed.save")}</Button>
        </>
      }
    >
      <div class="sales-ed">
        {inv.error ? <InlineAlert tone="warn">{t("sales.ed.lookups.err")}</InlineAlert> : null}
        <div class="sales-ed__grid">
          <Field label={t("sales.ed.number")} required error={tried && v.number ? t("sales.ed.err.number") : null} disabled={editing}>
            <Input value={number} onInput={(e) => setNumber((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label={t("sales.ed.customer")} optional>
            <Select value={contactId} placeholder={t("sales.ed.customer.pick")} options={customers.map((c) => ({ value: String(c.id), label: c.name }))} onChange={(e) => setContactId((e.target as HTMLSelectElement).value)} />
          </Field>
          <Field label={t("sales.ed.date")} required error={tried && v.date ? t("sales.ed.err.date") : null}>
            <Input type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label={t("sales.ed.due")} optional error={tried && v.due ? t("sales.ed.err.due") : null}>
            <Input type="date" value={due} onInput={(e) => setDue((e.target as HTMLInputElement).value)} />
          </Field>
        </div>
        <Field label={t("sales.ed.notes")} optional>
          <Textarea rows={2} value={notes} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />
        </Field>

        <h3 class="sales-h">{t("sales.ed.items")}</h3>
        {tried && v.items ? <InlineAlert tone="danger">{t("sales.ed.err.items")}</InlineAlert> : null}
        <ul class="sales-rows">
          {rows.map((r, k) => {
            const err: RowError | null = tried ? v.rows[k] ?? null : null;
            const known = r.kind === "stock" ? r.catalogPrice : null;
            return (
              <li key={k} class="sales-row">
                <div class="sales-row__main">
                  {r.kind === "stock" ? (
                    <Field label={t("sales.ed.item.pick")} error={err === "pick" ? t(rowErrKey.pick) : null}>
                      <Select value={r.inventoryItemId ? String(r.inventoryItemId) : ""} placeholder={t("sales.ed.item.pick")} options={invOptions} onChange={(e) => pick(k, (e.target as HTMLSelectElement).value)} />
                    </Field>
                  ) : (
                    <Field label={t("sales.ed.item.desc")} error={err === "desc" ? t(rowErrKey.desc) : null}>
                      <Input value={r.description} onInput={(e) => patch(k, { description: (e.target as HTMLInputElement).value })} />
                    </Field>
                  )}
                  <Field label={t("sales.ed.item.qty")} error={err === "qty" ? t(rowErrKey.qty) : null}>
                    <Input inputMode="decimal" value={r.qty} onInput={(e) => patch(k, { qty: (e.target as HTMLInputElement).value })} />
                  </Field>
                  {r.kind === "manual" ? (
                    <Field label={t("sales.ed.item.price")} error={err === "price" ? t(rowErrKey.price) : null}>
                      <Input inputMode="decimal" value={r.price} onInput={(e) => patch(k, { price: (e.target as HTMLInputElement).value })} />
                    </Field>
                  ) : (
                    <p class="sales-row__hint">{known ? t("sales.ed.item.catalog", { price: formatMoney(Number(known)) }) : t("sales.ed.item.catalog.auto")}</p>
                  )}
                </div>
                <Button variant="ghost" size="sm" icon={Trash} aria-label={t("sales.ed.item.remove")} onClick={() => setRows((rs) => rs.filter((_, i) => i !== k))}>
                  {t("sales.ed.item.remove")}
                </Button>
              </li>
            );
          })}
        </ul>
        <div class="sales-ed__add">
          <Button variant="secondary" size="sm" icon={Package} onClick={() => setRows((rs) => [...rs, { kind: "stock", inventoryItemId: null, description: "", qty: "1", price: "" }])}>
            {t("sales.ed.add.stock")}
          </Button>
          <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setRows((rs) => [...rs, { kind: "manual", inventoryItemId: null, description: "", qty: "1", price: "" }])}>
            {t("sales.ed.add.manual")}
          </Button>
        </div>
        <div class="sales-sum">
          <span>{t("sales.ed.sum")}</span>
          <strong>{formatMoney(Number(sum.total))}</strong>
        </div>
        {sum.partial && rows.length ? <p class="sales-muted">{t("sales.ed.sum.partial")}</p> : null}
      </div>
    </Dialog>
  );
}
