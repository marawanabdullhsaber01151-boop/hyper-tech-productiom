import { useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { useAct } from "../admin/act";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, ConfirmDialog, Dialog, Drawer, Field, InlineAlert, Input, Select, Skeleton, StatusPill } from "../design/components";
import { Pencil, Plus, Minus, ClipboardList, Trash } from "../design/icons";
import { formatDateTime, formatNumber } from "../lib/format";
import { adjustmentFor, moveError, stockValue, type Movement, type StockItem } from "./stockCore";
import { normNum } from "./salesCore";

const CATS = ["raw_material", "wip", "finished_good"] as const;
const unitOf = (i: Pick<StockItem, "unit">) => i.unit ?? "";
const fmt = (v: string | number) => formatNumber(Number(v) || 0);
const val = (e: Event) => (e.target as HTMLInputElement).value;

/** حالة الصنف (نفس منطق الشاشة الرئيسية) — اتكرر هنا عشان نتجنب import دائري. */
export function itemState(i: Pick<StockItem, "qty" | "minQty">): "out" | "low" | "ok" {
  const q = Number(i.qty);
  const m = Number(i.minQty);
  if (!(q > 0)) return "out";
  if (m > 0 && q <= m) return "low";
  return "ok";
}

/* ---------- حركة يدوية: استلام / صرف ---------- */
export function MovementDialog({ item, type, onClose, onDone }: { item: StockItem; type: "in" | "out"; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const cur = Number(item.qty) || 0;
  const err = moveError(type, qty, cur, reason);
  const after = (() => {
    const q = Number(normNum(qty));
    if (!(q > 0)) return null;
    return Math.round((type === "in" ? cur + q : cur - q) * 1000) / 1000;
  })();
  const save = async () => {
    setTried(true);
    if (err) return;
    const q = normNum(qty);
    const ok = await act.run(
      async () => {
        await api.post("/stock-movements", { inventoryItemId: item.id, movementType: type, qty: q, referenceType: "adjustment", notes: reason.trim() });
        return true;
      },
      t(type === "in" ? "inv.move.done.in" : "inv.move.done.out", { q: fmt(q), unit: unitOf(item) }),
    );
    if (ok) onDone();
  };
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={t(type === "in" ? "inv.move.title.in" : "inv.move.title.out", { name: item.name })}
      description={t("inv.move.desc", { q: fmt(item.qty), unit: unitOf(item), r: fmt(item.reservedQty ?? 0) })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} onClick={() => void save()}>{t("inv.move.save")}</Button>
        </>
      }
    >
      <div class="inv-form">
        <Field label={t("inv.move.qty")} required error={tried && err === "qty" ? t("inv.move.err.qty") : tried && err === "insufficient" ? t("inv.move.err.insufficient", { q: fmt(cur) }) : null}>
          <Input inputMode="decimal" value={qty} onInput={(e) => setQty(val(e))} />
        </Field>
        <Field label={t("inv.move.reason")} required hint={t("inv.move.reason.hint")} error={tried && err === "reason" ? t("inv.move.err.reason") : null}>
          <Input value={reason} onInput={(e) => setReason(val(e))} />
        </Field>
        {after !== null ? <p class={`inv-preview${after < 0 ? " is-bad" : ""}`}>{t("inv.move.preview", { q: fmt(after), unit: unitOf(item) })}</p> : null}
      </div>
    </Dialog>
  );
}

/* ---------- جرد ---------- */
export function CountDialog({ item, onClose, onDone }: { item: StockItem; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [counted, setCounted] = useState("");
  const [tried, setTried] = useState(false);
  const cur = Number(item.qty) || 0;
  const adj = adjustmentFor(cur, counted);
  const bad = counted.trim() !== "" && !/^\d+(?:\.\d{1,3})?$/.test(normNum(counted));
  const save = async () => {
    setTried(true);
    if (counted.trim() === "" || bad) return;
    if (!adj) {
      onClose();
      return;
    }
    const ok = await act.run(
      async () => {
        await api.post("/stock-movements", { inventoryItemId: item.id, movementType: adj.type, qty: adj.qty, referenceType: "adjustment", notes: t("inv.count.reason", { q: fmt(normNum(counted)) }) });
        return true;
      },
      t("inv.count.done"),
    );
    if (ok) onDone();
  };
  const diff = adj ? t(adj.type === "in" ? "inv.count.diff.in" : "inv.count.diff.out", { q: fmt(adj.qty) }) : counted.trim() !== "" && !bad ? t("inv.count.diff.none") : null;
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={t("inv.count.title", { name: item.name })}
      description={t("inv.count.desc")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} onClick={() => void save()}>{t("inv.count.save")}</Button>
        </>
      }
    >
      <div class="inv-form">
        <p class="inv-preview">{t("inv.count.current", { q: fmt(cur), unit: unitOf(item) })}</p>
        <Field label={t("inv.count.actual")} required error={tried && (bad || counted.trim() === "") ? t("inv.count.err") : null}>
          <Input inputMode="decimal" value={counted} onInput={(e) => setCounted(val(e))} />
        </Field>
        {diff ? <p class={`inv-preview${adj?.type === "out" ? " is-bad" : ""}`}>{diff}</p> : null}
      </div>
    </Dialog>
  );
}

/* ---------- إضافة / تعديل صنف ---------- */
interface LinkOpt {
  id: number;
  code: string;
  name: string;
  itemType: string;
  baseUnit: string | null;
  minStock: string | null;
  category: string;
}

export function ItemEditor({ item, onClose, onSaved }: { item?: StockItem; onClose: () => void; onSaved: () => void }) {
  const editing = !!item;
  const act = useAct();
  const links = useQuery((signal) => (editing ? Promise.resolve([] as LinkOpt[]) : api.get<LinkOpt[]>("/inventory/link-options", { signal })), []);
  const linked = !!item?.foundationItemId;
  const [pick, setPick] = useState("");
  const [name, setName] = useState(item?.name ?? "");
  const [code, setCode] = useState(item?.code ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [cat, setCat] = useState(item?.category ?? "raw_material");
  const [qty0, setQty0] = useState("");
  const [min, setMin] = useState(item ? String(Number(item.minQty) || 0) : "0");
  const [price, setPrice] = useState(item?.unitPrice !== undefined ? String(Number(item.unitPrice) || 0) : "0");
  const [tried, setTried] = useState(false);

  const opts = useMemo(() => (links.data ?? []).map((l) => ({ value: String(l.id), label: `${l.code} — ${l.name}` })), [links.data]);
  const choose = (v: string) => {
    setPick(v);
    const l = (links.data ?? []).find((x) => String(x.id) === v);
    if (!l) return;
    setName(l.name);
    setCode(l.code);
    setUnit(l.baseUnit ?? "");
    setCat(l.category);
    setMin(String(Number(l.minStock) || 0));
  };
  const okNum = (s: string) => /^\d+(?:\.\d{1,3})?$/.test(normNum(s));
  const errs = {
    link: !editing && !pick,
    name: !name.trim(),
    min: !okNum(min),
    price: !okNum(price),
    qty0: !editing && qty0.trim() !== "" && !okNum(qty0),
  };
  const invalid = Object.values(errs).some(Boolean);
  const save = async () => {
    setTried(true);
    if (invalid) return;
    const ok = await act.run(
      async () => {
        if (editing) {
          const body: Record<string, unknown> = { minQty: normNum(min), unitPrice: normNum(price), category: cat };
          if (!linked) Object.assign(body, { name: name.trim(), code: code.trim() || null, unit: unit.trim() || null });
          await api.patch(`/inventory/${item!.id}`, body);
        } else {
          const created = await api.post<{ id: number }>("/inventory", {
            name: name.trim(),
            code: code.trim() || null,
            unit: unit.trim() || null,
            category: cat,
            minQty: normNum(min),
            unitPrice: normNum(price),
            foundationItemId: Number(pick),
          });
          const open = normNum(qty0);
          if (open && Number(open) > 0) {
            await api.post("/stock-movements", { inventoryItemId: created.id, movementType: "in", qty: open, referenceType: "adjustment", notes: t("inv.ed.opening") });
          }
        }
        return true;
      },
      t(editing ? "inv.ed.updated" : "inv.ed.created"),
    );
    if (ok) onSaved();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? t("inv.ed.title.edit", { name: item!.name }) : t("inv.ed.title.new")}
      description={editing ? (linked ? t("inv.ed.locked") : undefined) : t("inv.ed.desc.new")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} onClick={() => void save()}>{t("inv.ed.save")}</Button>
        </>
      }
    >
      <div class="inv-form">
        {!editing ? (
          <>
            {links.error ? <InlineAlert tone="danger">{t("inv.ed.link.err")}</InlineAlert> : null}
            {!links.loading && !links.error && opts.length === 0 ? <InlineAlert tone="info">{t("inv.ed.link.none")}</InlineAlert> : null}
            <Field label={t("inv.ed.link")} required error={tried && errs.link ? t("inv.ed.err.link") : null}>
              <Select value={pick} placeholder={t("inv.ed.link.pick")} options={opts} onChange={(e) => choose((e.target as HTMLSelectElement).value)} />
            </Field>
          </>
        ) : null}
        <div class="inv-grid">
          <Field label={t("inv.ed.name")} required disabled={editing ? linked : true} error={tried && errs.name ? t("inv.ed.err.name") : null}>
            <Input value={name} onInput={(e) => setName(val(e))} />
          </Field>
          <Field label={t("inv.ed.code")} disabled={editing ? linked : true}>
            <Input value={code} onInput={(e) => setCode(val(e))} />
          </Field>
          <Field label={t("inv.ed.unit")} disabled={editing ? linked : true}>
            <Input value={unit} onInput={(e) => setUnit(val(e))} />
          </Field>
          <Field label={t("inv.ed.cat")}>
            <Select value={cat} options={CATS.map((c) => ({ value: c, label: t(`staff.stock.cat.${c}` as CopyKey) }))} onChange={(e) => setCat((e.target as HTMLSelectElement).value)} />
          </Field>
          <Field label={t("inv.ed.min")} error={tried && errs.min ? t("inv.ed.err.num") : null}>
            <Input inputMode="decimal" value={min} onInput={(e) => setMin(val(e))} />
          </Field>
          <Field label={t("inv.ed.price")} error={tried && errs.price ? t("inv.ed.err.num") : null}>
            <Input inputMode="decimal" value={price} onInput={(e) => setPrice(val(e))} />
          </Field>
          {!editing ? (
            <Field label={t("inv.ed.qty0")} optional error={tried && errs.qty0 ? t("inv.ed.err.num") : null}>
              <Input inputMode="decimal" value={qty0} onInput={(e) => setQty0(val(e))} />
            </Field>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

/* ---------- تفاصيل الصنف (Drawer) ---------- */
export interface ItemDrawerProps {
  item: StockItem;
  onClose: () => void;
  onIn: () => void;
  onOut: () => void;
  onCount: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  canDelete: boolean;
}

export function ItemDrawer({ item, onClose, onIn, onOut, onCount, onEdit, onDeleted, canDelete }: ItemDrawerProps) {
  const act = useAct();
  const [del, setDel] = useState(false);
  const recent = useQuery((signal) => api.get<Movement[]>("/stock-movements", { signal, query: { item_id: String(item.id) } }), [item.id, item.qty]);
  const s = itemState(item);
  const v = stockValue(item);
  const doDelete = async () => {
    const ok = await act.run(
      async () => {
        await api.delete<unknown>(`/inventory/${item.id}`);
        return true;
      },
      t("inv.deleted"),
    );
    if (!ok) return;
    setDel(false);
    onDeleted();
  };
  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={item.name}
        footer={
          <div class="inv-foot">
            <Button icon={Plus} onClick={onIn}>{t("inv.act.in")}</Button>
            <Button variant="secondary" icon={Minus} onClick={onOut} disabled={!(Number(item.qty) > 0)}>{t("inv.act.out")}</Button>
            <Button variant="secondary" icon={ClipboardList} onClick={onCount}>{t("inv.act.count")}</Button>
            <Button variant="secondary" icon={Pencil} onClick={onEdit}>{t("inv.act.edit")}</Button>
            {canDelete ? <Button variant="ghost" icon={Trash} onClick={() => setDel(true)}>{t("inv.act.delete")}</Button> : null}
          </div>
        }
      >
        <div class="inv-detail">
          <div class="inv-detail__pills">
            <StatusPill tone={s === "out" ? "danger" : s === "low" ? "warn" : "success"}>{t(`staff.stock.status.${s}` as CopyKey)}</StatusPill>
            <StatusPill tone="neutral">{t(`staff.stock.cat.${item.category}` as CopyKey)}</StatusPill>
            {item.code ? <StatusPill tone="neutral">{item.code}</StatusPill> : null}
          </div>
          {s === "out" ? <InlineAlert tone="danger">{t("inv.out.note")}</InlineAlert> : null}
          {s === "low" ? <InlineAlert tone="warn">{t("inv.low.note", { q: fmt(item.qty), m: fmt(item.minQty) })}</InlineAlert> : null}
          <dl class="inv-facts">
            <div><dt>{t("inv.drawer.qty")}</dt><dd>{fmt(item.qty)} {unitOf(item)}</dd></div>
            <div><dt>{t("inv.drawer.reserved")}</dt><dd>{fmt(item.reservedQty ?? 0)}</dd></div>
            <div><dt>{t("inv.drawer.avail")}</dt><dd>{fmt(item.availableQty)}</dd></div>
            <div><dt>{t("inv.drawer.min")}</dt><dd>{fmt(item.minQty)}</dd></div>
            {item.unitPrice !== undefined ? <div><dt>{t("inv.drawer.price")}</dt><dd>{fmt(item.unitPrice)}</dd></div> : null}
            {v !== null ? <div><dt>{t("inv.drawer.value")}</dt><dd>{fmt(v)}</dd></div> : null}
          </dl>
          <h3 class="inv-h">{t("inv.drawer.recent")}</h3>
          {recent.loading && !recent.data ? <Skeleton lines={3} /> : null}
          {recent.error ? <InlineAlert tone="danger">{t("inv.drawer.err")}</InlineAlert> : null}
          {recent.data && recent.data.length === 0 ? <p class="inv-muted">{t("inv.drawer.recent.none")}</p> : null}
          <ul class="inv-recent">
            {(recent.data ?? []).slice(0, 8).map((m) => (
              <li key={m.id}>
                <StatusPill tone={m.movementType === "in" ? "success" : "warn"}>{t(m.movementType === "in" ? "inv.mv.type.in" : "inv.mv.type.out")}</StatusPill>
                <strong>{fmt(m.qty)}</strong>
                <span class="inv-muted">{m.notes ?? ""}</span>
                <time class="inv-muted">{formatDateTime(m.createdAt)}</time>
              </li>
            ))}
          </ul>
        </div>
      </Drawer>
      <ConfirmDialog open={del} danger loading={act.busy} onClose={() => setDel(false)} onConfirm={() => void doDelete()} title={t("inv.del.title", { name: item.name })} description={t("inv.del.desc")} confirmLabel={t("inv.act.delete")} />
    </>
  );
}
