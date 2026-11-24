import "../copy/costing";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, StatusPill, Tabs, Textarea, type Column, type Tone } from "../design/components";
import { formatDate, formatDateTime, formatMoney } from "../lib/format";
import "./Engineering.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const k = (key: string) => key as CopyKey;
const money = (v: string | number) => formatMoney(Number(v));
const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;
const YIELD_RE = /^\d{1,3}(\.\d{1,2})?$/;
/** موجب = زيادة تكلفة = غير مفضّل. */
const tone = (v: string): Tone => (Number(v) > 0 ? "danger" : Number(v) < 0 ? "success" : "neutral");

interface BatchRow { batchId: number; batchNumber: string; status: string; produced: string; accepted: string; orderId: number; orderNumber: string; productName: string; sheetStatus: string | null; actualTotal: string | null; standardTotal: string | null; varianceTotal: string | null; profit: string | null }
interface Parts { material: string; labor: string; machine: string; energy: string; overhead: string; waste?: string; total: string }
interface Sheet {
  meta: { batchId: number; batchNumber: string; batchStatus: string; orderNumber: string; productName: string };
  warnings: string[];
  saved: { status: "draft" | "final"; computedAt: string; computedByName: string; finalizedAt: string | null; finalizedByName: string | null } | null;
  qty: { produced: string; accepted: string; scrap: string; rework: string; yieldPercent: string | null };
  std: Parts; act: Parts; variance: Parts; efficiencyLoss: string; unitCost: string | null; unitPrice: string | null; priceSource: string | null; revenue: string | null; profit: string | null; marginPercent: string | null;
}
interface StdRow { recipeId: number; productName: string; outputQty: string; material: string; hasStandard: boolean; labor: string; machine: string; energy: string; overhead: string; yieldPercent: string; version: number }
interface HistRow { version: number; labor: string; machine: string; energy: string; overhead: string; yieldPercent: string; reason: string; changedByName: string; createdAt: string }

/** تبويب «التكلفة»: كشف تكلفة كل دفعة (معياري/فعلي/انحراف/ربحية) ومعايير الوصفات. */
export function CostingPanel() {
  const [sub, setSub] = useState("batches");
  return (
    <div class="ad-stack">
      <p class="eng-muted">{t("cst.hint")}</p>
      <Tabs label={t("cst.tab")} value={sub} onChange={setSub} tabs={[
        { id: "batches", label: t("cst.sub.batches"), panel: <Batches /> },
        { id: "standards", label: t("cst.sub.standards"), panel: <Standards /> },
      ]} />
    </div>
  );
}

/* ---------------- الدفعات ---------------- */
function Batches() {
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery((signal) => api.get<{ items: BatchRow[] }>(`/costing/batches?status=${status}`, { signal }), [status]);
  const cols: Column<BatchRow>[] = [
    { key: "b", header: t("cst.b.c.batch"), cell: (r) => <span class="num" dir="ltr">{r.batchNumber}</span>, mobile: "title" },
    { key: "p", header: t("cst.b.c.product"), cell: (r) => r.productName },
    { key: "q", header: t("cst.b.c.qty"), cell: (r) => <span class="num" dir="ltr">{r.produced} / {r.accepted}</span> },
    { key: "a", header: t("cst.b.c.actual"), cell: (r) => (r.actualTotal === null ? "—" : money(r.actualTotal)) },
    { key: "s", header: t("cst.b.c.std"), cell: (r) => (r.standardTotal === null ? "—" : money(r.standardTotal)) },
    { key: "v", header: t("cst.b.c.var"), cell: (r) => (r.varianceTotal === null ? "—" : <StatusPill tone={tone(r.varianceTotal)}>{money(r.varianceTotal)}</StatusPill>) },
    { key: "pf", header: t("cst.b.c.profit"), cell: (r) => (r.profit === null ? "—" : money(r.profit)) },
    { key: "sh", header: t("cst.b.c.sheet"), cell: (r) => (r.sheetStatus ? <StatusPill tone={r.sheetStatus === "final" ? "success" : "info"}>{t(k(`cst.b.s.${r.sheetStatus}`))}</StatusPill> : t("cst.b.s.none")) },
    { key: "o", header: "", cell: (r) => <Button size="sm" variant="ghost" onClick={() => setOpen(r.batchId)}>{t("cst.b.open.btn")}</Button> },
  ];
  return (
    <div class="ad-stack">
      <Field label={t("cst.b.filter")}>
        <Select value={status} onChange={(e) => setStatus(val(e))} options={["all", "completed", "open"].map((x) => ({ value: x, label: t(k(`cst.b.${x}`)) }))} />
      </Field>
      {q.error ? <InlineAlert tone="warn">{t("cst.b.err")}</InlineAlert> : <DataTable columns={cols} rows={q.data?.items ?? []} rowKey={(r) => r.batchId} caption={t("cst.b.caption")} empty={<EmptyState compact title={t("cst.b.empty")} />} />}
      {open !== null ? <SheetDialog batchId={open} onClose={() => setOpen(null)} onChanged={() => void q.refetch()} /> : null}
    </div>
  );
}

function SheetDialog({ batchId, onClose, onChanged }: { batchId: number; onClose: () => void; onChanged: () => void }) {
  const act = useAct();
  const [override, setOverride] = useState<Sheet | null>(null);
  const q = useQuery((signal) => api.get<Sheet>(`/costing/batches/${batchId}`, { signal }), [batchId]);
  const s = override ?? q.data;
  const isFinal = s?.saved?.status === "final";
  const post = async (path: string, msg: string) => {
    const r = await act.run(() => api.post<Sheet>(`/costing/batches/${batchId}/${path}`, {}), msg);
    if (r) { setOverride(r); onChanged(); }
  };
  const rowsDef: Array<{ id: keyof Parts; label: string }> = [
    { id: "material", label: t("cst.d.material") }, { id: "labor", label: t("cst.d.labor") }, { id: "machine", label: t("cst.d.machine") },
    { id: "energy", label: t("cst.d.energy") }, { id: "overhead", label: t("cst.d.overhead") },
  ];
  return (
    <Dialog open onClose={onClose} title={t("cst.d.title", { n: s?.meta.batchNumber ?? "" })} description={s ? t("cst.d.sub", { p: s.meta.productName, o: s.meta.orderNumber }) : undefined}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("cst.d.close")}</Button>
        {s && !isFinal ? <Button variant="ghost" loading={act.busy} onClick={() => void post("sheet", t("cst.d.saved"))}>{t("cst.d.save")}</Button> : null}
        {s && !isFinal ? <Button loading={act.busy} disabled={s.meta.batchStatus !== "completed"} onClick={() => void post("finalize", t("cst.d.finalized"))}>{t("cst.d.final")}</Button> : null}
      </>}>
      {q.error ? <InlineAlert tone="warn">{t("cst.d.err")}</InlineAlert> : null}
      {s ? (
        <div class="eng-form">
          {s.warnings.map((w) => <InlineAlert key={w} tone="warn">{t(k(`cst.d.w.${w}`))}</InlineAlert>)}
          <p class="eng-muted">
            {isFinal && s.saved ? t("cst.d.isFinal", { w: formatDateTime(s.saved.finalizedAt ?? s.saved.computedAt), n: s.saved.finalizedByName ?? "" })
              : s.saved ? t("cst.d.isDraft", { w: formatDateTime(s.saved.computedAt) }) : t("cst.d.notSaved")}
          </p>
          {!isFinal ? <p class="eng-muted">{s.meta.batchStatus !== "completed" ? t("cst.d.needComplete") : t("cst.d.finalHint")}</p> : null}
          <h3 class="eng-h">{t("cst.d.qtyTitle")}</h3>
          <p class="num" dir="ltr">{t("cst.d.produced")}: {s.qty.produced} | {t("cst.d.accepted")}: {s.qty.accepted} | {t("cst.d.scrap")}: {s.qty.scrap} | {t("cst.d.rework")}: {s.qty.rework}{s.qty.yieldPercent ? ` | ${t("cst.d.yield")}: ${s.qty.yieldPercent}%` : ""}</p>
          <h3 class="eng-h">{t("cst.d.table")}</h3>
          <div class="ht-tablewrap">
            <table class="ht-table">
              <thead><tr><th scope="col">{t("cst.d.c.item")}</th><th scope="col">{t("cst.d.c.std")}</th><th scope="col">{t("cst.d.c.act")}</th><th scope="col">{t("cst.d.c.var")}</th></tr></thead>
              <tbody>
                {rowsDef.map((r) => (
                  <tr key={r.id}><th scope="row">{r.label}</th><td>{money(s.std[r.id] as string)}</td><td>{money(s.act[r.id] as string)}</td><td><StatusPill tone={tone(s.variance[r.id] as string)}>{money(s.variance[r.id] as string)}</StatusPill></td></tr>
                ))}
                <tr><th scope="row">{t("cst.d.waste")}</th><td>—</td><td>{money(s.act.waste ?? "0")}</td><td><StatusPill tone={tone(s.variance.waste ?? "0")}>{money(s.variance.waste ?? "0")}</StatusPill></td></tr>
                <tr><th scope="row">{t("cst.d.total")}</th><td>{money(s.std.total)}</td><td>{money(s.act.total)}</td><td><StatusPill tone={tone(s.variance.total)}>{money(s.variance.total)}</StatusPill></td></tr>
              </tbody>
            </table>
          </div>
          <p>{t("cst.d.eff", { n: money(s.efficiencyLoss) })}</p>
          <p class="eng-muted">{t("cst.d.effNote")}</p>
          {s.unitCost !== null ? <p>{t("cst.d.unitCost", { n: money(s.unitCost) })}</p> : null}
          {s.unitPrice !== null ? <p>{t("cst.d.price", { n: money(s.unitPrice), s: s.priceSource ? t(k(`cst.d.src.${s.priceSource}`)) : "" })}</p> : null}
          {s.revenue !== null ? <p>{t("cst.d.revenue", { n: money(s.revenue) })}</p> : null}
          {s.profit !== null ? <p><StatusPill tone={Number(s.profit) >= 0 ? "success" : "danger"}>{Number(s.profit) >= 0 ? t("cst.d.profit", { n: money(s.profit), m: s.marginPercent ?? "0" }) : t("cst.d.loss", { n: money(String(Math.abs(Number(s.profit)))), m: s.marginPercent ?? "0" })}</StatusPill></p> : null}
        </div>
      ) : null}
    </Dialog>
  );
}

/* ---------------- المعايير ---------------- */
function Standards() {
  const [editing, setEditing] = useState<StdRow | null>(null);
  const q = useQuery((signal) => api.get<{ items: StdRow[] }>("/costing/standards", { signal }), []);
  const cols: Column<StdRow>[] = [
    { key: "r", header: t("cst.s.c.recipe"), cell: (r) => r.productName, mobile: "title" },
    { key: "q", header: t("cst.s.c.batch"), cell: (r) => <span class="num" dir="ltr">{r.outputQty}</span> },
    { key: "m", header: t("cst.s.c.material"), cell: (r) => money(r.material) },
    { key: "l", header: t("cst.s.c.labor"), cell: (r) => (r.hasStandard ? money(r.labor) : "—") },
    { key: "ma", header: t("cst.s.c.machine"), cell: (r) => (r.hasStandard ? money(r.machine) : "—") },
    { key: "e", header: t("cst.s.c.energy"), cell: (r) => (r.hasStandard ? money(r.energy) : "—") },
    { key: "o", header: t("cst.s.c.overhead"), cell: (r) => (r.hasStandard ? money(r.overhead) : "—") },
    { key: "y", header: t("cst.s.c.yield"), cell: (r) => (r.hasStandard ? r.yieldPercent : "—") },
    { key: "v", header: t("cst.s.c.ver"), cell: (r) => (r.hasStandard ? r.version : <StatusPill tone="warn">{t("cst.s.none")}</StatusPill>) },
    { key: "a", header: "", cell: (r) => <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>{t("cst.s.edit")}</Button> },
  ];
  return (
    <div class="ad-stack">
      <p class="eng-muted">{t("cst.s.hint")}</p>
      {q.error ? <InlineAlert tone="warn">{t("cst.s.err")}</InlineAlert> : <DataTable columns={cols} rows={q.data?.items ?? []} rowKey={(r) => r.recipeId} caption={t("cst.s.caption")} empty={<EmptyState compact title={t("cst.s.empty")} />} />}
      {editing ? <StdDialog row={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void q.refetch(); }} /> : null}
    </div>
  );
}

function StdDialog({ row, onClose, onDone }: { row: StdRow; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [f, setF] = useState({ labor: row.labor, machine: row.machine, energy: row.energy, overhead: row.overhead, yieldPercent: row.yieldPercent, reason: "" });
  const hist = useQuery((signal) => api.get<{ items: HistRow[] }>(`/costing/standards/${row.recipeId}/history`, { signal }), [row.recipeId]);
  const set = (key: keyof typeof f) => (e: Event) => setF({ ...f, [key]: val(e) });
  const ok = [f.labor, f.machine, f.energy, f.overhead].every((x) => MONEY_RE.test(x.trim())) && YIELD_RE.test(f.yieldPercent.trim()) && Number(f.yieldPercent) > 0 && Number(f.yieldPercent) <= 100 && f.reason.trim().length >= 3;
  const go = async () => {
    const body = { labor: f.labor.trim(), machine: f.machine.trim(), energy: f.energy.trim(), overhead: f.overhead.trim(), yieldPercent: f.yieldPercent.trim(), reason: f.reason.trim() };
    const r = await act.run(() => api.put(`/costing/standards/${row.recipeId}`, body), t("cst.s.saved"));
    if (r) onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("cst.s.editTitle", { p: row.productName })} description={t("cst.s.editDesc", { q: row.outputQty })}
      footer={<><Button variant="ghost" onClick={onClose}>{t("cst.s.cancel")}</Button><Button loading={act.busy} disabled={!ok} onClick={() => void go()}>{t("cst.s.save")}</Button></>}>
      <div class="eng-form">
        <Field label={t("cst.s.f.labor")} required><Input value={f.labor} inputMode="decimal" dir="ltr" onInput={set("labor")} /></Field>
        <Field label={t("cst.s.f.machine")} required><Input value={f.machine} inputMode="decimal" dir="ltr" onInput={set("machine")} /></Field>
        <Field label={t("cst.s.f.energy")} required><Input value={f.energy} inputMode="decimal" dir="ltr" onInput={set("energy")} /></Field>
        <Field label={t("cst.s.f.overhead")} required><Input value={f.overhead} inputMode="decimal" dir="ltr" onInput={set("overhead")} /></Field>
        <Field label={t("cst.s.f.yield")} required><Input value={f.yieldPercent} inputMode="decimal" dir="ltr" onInput={set("yieldPercent")} /></Field>
        <Field label={t("cst.s.f.reason")} required><Textarea value={f.reason} maxLength={300} onInput={set("reason")} /></Field>
        <h3 class="eng-h">{t("cst.s.history")}</h3>
        {(hist.data?.items ?? []).length === 0 ? <p class="eng-muted">{t("cst.s.h.empty")}</p> : (hist.data?.items ?? []).map((h) => (
          <p key={h.version} class="eng-muted">
            <strong>{t("cst.s.h.ver", { v: h.version })}</strong> {t("cst.s.h.line", { l: money(h.labor), m: money(h.machine), e: money(h.energy), o: money(h.overhead), y: h.yieldPercent })} — {h.reason} — {t("cst.s.h.by", { n: h.changedByName, w: formatDate(h.createdAt) })}
          </p>
        ))}
      </div>
    </Dialog>
  );
}
