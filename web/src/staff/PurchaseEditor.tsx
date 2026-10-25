import { useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { useAct } from "../admin/act";
import { useQuery } from "../api/hooks";
import { t } from "../copy";
import { Button, Dialog, Field, InlineAlert, Input, Select, Textarea, useToast, type Option } from "../design/components";
import { Plus, Trash } from "../design/icons";
import { formatMoney } from "../lib/format";
import { draftTotal, toPayload, validateDraft, type Draft, type DraftLine, type PoFull } from "./purchasingCore";

interface InvOpt {
  id: number;
  name: string;
  unit?: string | null;
}
interface SupOpt {
  id: number;
  name: string;
}
const val = (e: Event) => (e.target as HTMLInputElement).value;
const errKey = { pick: "po.ed.err.pick", qty: "po.ed.err.qty", price: "po.ed.err.price", dup: "po.ed.err.dup" } as const;

function fromOrder(o: PoFull): Draft {
  return {
    supplierId: String(o.supplierId),
    expectedDate: o.expectedDate ?? "",
    notes: o.notes ?? "",
    lines: o.items.map((i) => ({
      inventoryItemId: String(i.inventoryItemId),
      qty: String(Number(i.qty)),
      price: i.unitPrice !== undefined && Number(i.unitPrice) > 0 ? String(Number(i.unitPrice)) : "",
      ...(i.requisitionSource && i.requisitionId ? { requisition: { source: i.requisitionSource as "ops" | "plan", id: i.requisitionId, number: `${i.requisitionSource === "ops" ? "OC" : "PR"}-${i.requisitionId}` } } : {}),
    })),
  };
}

/** إنشاء/تعديل مسودة أمر شراء. من احتياجات: بيتملي المورد والبنود من تلقاء نفسه. */
export function PurchaseEditor({ order, initial, onClose, onSaved }: { order?: PoFull; initial?: Pick<Draft, "supplierId" | "lines">; onClose: () => void; onSaved: (o: PoFull) => void }) {
  const editing = !!order;
  const sups = useQuery((signal) => api.get<SupOpt[]>("/purchases/suppliers", { signal }), []);
  const inv = useQuery((signal) => api.get<InvOpt[]>("/inventory", { signal }), []);
  const act = useAct();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => (order ? fromOrder(order) : { supplierId: initial?.supplierId ?? "", expectedDate: "", notes: "", lines: initial?.lines ?? [] }));
  const [tried, setTried] = useState(false);
  const v = useMemo(() => validateDraft(d), [d]);
  const sum = useMemo(() => draftTotal(d.lines), [d.lines]);
  const invOptions: Option[] = (inv.data ?? []).map((i) => ({ value: String(i.id), label: i.unit ? `${i.name} (${i.unit})` : i.name }));
  const supOptions: Option[] = (sups.data ?? []).map((s) => ({ value: String(s.id), label: s.name }));
  const patchLine = (k: number, p: Partial<DraftLine>) => setD((x) => ({ ...x, lines: x.lines.map((l, i) => (i === k ? { ...l, ...p } : l)) }));

  const save = async () => {
    setTried(true);
    if (!v.ok) return;
    const r = await act.run(() => (editing ? api.patch<PoFull>(`/purchases/${order!.id}`, toPayload(d)) : api.post<PoFull>("/purchases", toPayload(d))));
    if (!r) return;
    toast({ tone: "success", message: editing ? t("po.ed.saved") : t("po.ed.created", { n: r.poNumber }) });
    onSaved(r);
  };

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={editing ? t("po.ed.title.edit", { n: order!.poNumber }) : t("po.ed.title.new")}
      description={t("po.ed.desc")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} onClick={() => void save()}>{t("po.ed.save")}</Button>
        </>
      }
    >
      <div class="po-ed">
        {sups.error || inv.error ? <InlineAlert tone="warn">{t("po.ed.lookups.err")}</InlineAlert> : null}
        <div class="po-ed__grid">
          <Field label={t("po.ed.supplier")} required error={tried && v.supplier ? t("po.ed.err.supplier") : null}>
            <Select value={d.supplierId} placeholder={t("po.ed.supplier.pick")} options={supOptions} onChange={(e) => setD((x) => ({ ...x, supplierId: (e.target as HTMLSelectElement).value }))} />
          </Field>
          <Field label={t("po.ed.expected")} optional>
            <Input type="date" value={d.expectedDate} onInput={(e) => setD((x) => ({ ...x, expectedDate: val(e) }))} />
          </Field>
        </div>
        <Field label={t("po.ed.notes")} optional>
          <Textarea rows={2} value={d.notes} onInput={(e) => setD((x) => ({ ...x, notes: (e.target as HTMLTextAreaElement).value }))} />
        </Field>

        <h3 class="po-h">{t("po.ed.items")}</h3>
        {tried && v.items ? <InlineAlert tone="danger">{t("po.ed.err.items")}</InlineAlert> : null}
        <ul class="po-rows">
          {d.lines.map((l, k) => {
            const e = tried ? v.lines[k] ?? null : null;
            return (
              <li key={k} class="po-row">
                <div class="po-row__main">
                  <Field label={t("po.ed.item")} error={e === "pick" || e === "dup" ? t(errKey[e]) : null}>
                    <Select value={l.inventoryItemId} placeholder={t("po.ed.item.pick")} options={invOptions} onChange={(ev) => patchLine(k, { inventoryItemId: (ev.target as HTMLSelectElement).value })} />
                  </Field>
                  <Field label={t("po.ed.qty")} error={e === "qty" ? t(errKey.qty) : null}>
                    <Input inputMode="decimal" value={l.qty} onInput={(ev) => patchLine(k, { qty: val(ev) })} />
                  </Field>
                  <Field label={t("po.ed.price")} error={e === "price" ? t(errKey.price) : null}>
                    <Input inputMode="decimal" value={l.price} onInput={(ev) => patchLine(k, { price: val(ev) })} />
                  </Field>
                </div>
                <div class="po-row__side">
                  {l.requisition ? <span class="po-muted">{t("po.ed.fromneed", { n: l.requisition.number })}</span> : null}
                  <Button variant="ghost" size="sm" icon={Trash} onClick={() => setD((x) => ({ ...x, lines: x.lines.filter((_, i) => i !== k) }))}>{t("po.ed.remove")}</Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div>
          <Button variant="secondary" icon={Plus} onClick={() => setD((x) => ({ ...x, lines: [...x.lines, { inventoryItemId: "", qty: "", price: "" }] }))}>{t("po.ed.add")}</Button>
        </div>
        <div class="po-sum"><span>{t("po.ed.total")}</span><strong>{formatMoney(sum)}</strong></div>
      </div>
    </Dialog>
  );
}
