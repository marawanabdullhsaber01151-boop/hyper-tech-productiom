import "../copy/warehouses";
import { useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { useAct } from "../admin/act";
import { navigate } from "../app/router";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Checkbox, ConfirmDialog, DataTable, Dialog, EmptyState, Field, FilterBar, InlineAlert, Input, Stat, StatusPill, Tabs, Textarea, useToast, type Column } from "../design/components";
import { Plus } from "../design/icons";
import { formatNumber } from "../lib/format";
import { availOf, filterStock, parsePageParams, partsText, stockCounts, stockCsv, whState, type WhItem, type WhKind, type WhStockRow } from "./warehousesCore";
import "./Stock.css";
import "./Warehouses.css";

interface ListDto { kinds: WhKind[]; canManage: boolean; items: WhItem[] }
interface StockDto { kind: WhKind; mode: "combined" | "separate"; warehouses: Array<{ id: number; name: string; active: boolean }>; rows: WhStockRow[] }
interface Keeper { id: number; name: string }
const TONE = { out: "danger", low: "warn", ok: "success" } as const;
const num = (v: string) => formatNumber(Number(v) || 0);
/** السايدبار بيقرا قايمة المخازن من /nav؛ بعد أي إنشاء/إيقاف/تعديل اسم بنقوله يحدّثها. */
const keepersText = (w: WhItem) => (w.keepers.length ? w.keepers.map((k) => k.name).join(t("wh.sep")) : t("wh.keepers.none"));
const refreshNav = () => window.dispatchEvent(new Event("hyper:nav-refresh"));

function NameDialog({ kind, wh, onClose, onDone }: { kind: WhKind; wh?: WhItem; onClose: () => void; onDone: (id: number) => void }) {
  const act = useAct();
  const [name, setName] = useState(wh?.name ?? "");
  const [notes, setNotes] = useState(wh?.notes ?? "");
  const [tried, setTried] = useState(false);
  const bad = name.trim() === "" || name.trim().length > 60;
  const save = async () => {
    setTried(true);
    if (bad) return;
    const id = await act.run(async () => {
      if (wh) {
        await api.patch(`/warehouses/${wh.id}`, { name: name.trim(), notes: notes.trim() || null });
        return wh.id;
      }
      const r = await api.post<{ id: number; name: string }>("/warehouses", { kind, name: name.trim(), notes: notes.trim() || null });
      return r.id;
    }, t(wh ? "wh.saved" : "wh.created", { n: name.trim() }));
    if (id !== undefined) onDone(id);
  };
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={wh ? t("wh.rename.title", { n: wh.name }) : t("wh.new.title", { kind: t(`wh.kind.${kind}` as CopyKey) })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("wh.cancel")}</Button>
          <Button loading={act.busy} onClick={() => void save()}>{t(wh ? "wh.save" : "wh.create")}</Button>
        </>
      }
    >
      <div class="inv-form">
        <Field label={t("wh.field.name")} required hint={t("wh.field.name.hint")} error={tried && bad ? t("wh.pick.needed") : null}>
          <Input value={name} maxLength={60} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
        </Field>
        <Field label={t("wh.field.notes")}>
          <Textarea rows={3} value={notes} maxLength={300} onInput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function KeepersDialog({ wh, onClose, onDone }: { wh: WhItem; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const users = useQuery((signal) => api.get<Keeper[]>("/warehouses/storekeepers", { signal }), []);
  const [sel, setSel] = useState<number[]>(() => wh.keepers.map((k) => k.userId));
  const list = Array.isArray(users.data) ? users.data : [];
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const save = async () => {
    const ok = await act.run(async () => {
      await api.put(`/warehouses/${wh.id}/keepers`, { userIds: sel });
      return true;
    }, t("wh.keepers.saved"));
    if (ok) onDone();
  };
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={t("wh.keepers.title", { n: wh.name })}
      description={t("wh.keepers.hint")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("wh.cancel")}</Button>
          <Button loading={act.busy} onClick={() => void save()}>{t("wh.save")}</Button>
        </>
      }
    >
      <div class="wh-keep">
        {users.error ? <InlineAlert tone="danger" title={t("wh.loadFail")}>{users.error.message}</InlineAlert> : null}
        {!users.loading && !users.error && list.length === 0 ? <p class="inv-muted">{t("wh.keepers.empty")}</p> : null}
        {list.map((u) => (
          <Checkbox key={u.id} label={u.name} checked={sel.includes(u.id)} onChange={() => toggle(u.id)} />
        ))}
      </div>
    </Dialog>
  );
}

function WarehouseCard({ w, canManage, onOpen }: { w: WhItem; canManage: boolean; onOpen: () => void }) {
  return (
    <div class="wh-card">
      <div class="wh-card__head">
        <h3 class="wh-card__name">{w.name}</h3>
        {w.isDefault ? <StatusPill tone="info">{t("wh.badge.default")}</StatusPill> : null}
        {!w.active ? <StatusPill tone="neutral">{t("wh.badge.inactive")}</StatusPill> : null}
      </div>
      <p class="wh-meta">{t("wh.code")}: {w.code} • {t("wh.col.items")}: {formatNumber(w.itemsCount)}</p>
      {canManage ? <p class="wh-meta">{t("wh.keepers")}: {keepersText(w)}</p> : null}
      <Button size="sm" variant="secondary" onClick={onOpen}>{t("wh.open")}</Button>
    </div>
  );
}

/** صفحة المخازن: ?kind=raw|wip|finished & wh=all|<id> & new=1. كل دور بيشوف نوعه (السيرفر هو اللي بيحكم). */
export function Warehouses() {
  const { kind, wh, wantNew } = parsePageParams(location.search);
  const toast = useToast();
  const act = useAct();
  const [mode, setMode] = useState<"separate" | "combined">("separate");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("items");
  const [dlg, setDlg] = useState<"new" | "edit" | "keepers" | "stop" | null>(wantNew ? "new" : null);
  const list = useQuery((signal) => api.get<ListDto>("/warehouses", { signal }), []);
  const stock = useQuery<StockDto | undefined>(
    (signal) => (kind ? api.get<StockDto>("/warehouses/stock", { signal, query: { kind: wh === "all" ? kind : undefined, warehouseId: wh === "all" ? undefined : wh, mode: wh === "all" ? mode : "separate" } }) : Promise.resolve(undefined)),
    [kind, wh, mode],
  );
  const dto = list.data;
  const mine = useMemo(() => (dto?.items ?? []).filter((w) => w.kind === kind), [dto, kind]);
  const cur = wh === "all" ? undefined : mine.find((w) => w.id === wh);
  const rows = stock.data?.rows ?? [];
  const shown = useMemo(() => filterStock(rows, search), [rows, search]);
  const counts = useMemo(() => stockCounts(rows), [rows]);
  const combined = wh === "all" && mode === "combined";
  const allowed = !kind || !dto || dto.kinds.includes(kind);

  const after = () => {
    setDlg(null);
    refreshNav();
    void list.refetch();
    void stock.refetch();
  };
  const toggleActive = async () => {
    if (!cur) return;
    const ok = await act.run(async () => {
      await api.patch(`/warehouses/${cur.id}`, { active: !cur.active });
      return true;
    }, t(cur.active ? "wh.stopped" : "wh.resumed"));
    if (ok) after();
  };
  const exportCsv = () => {
    if (!shown.length) {
      toast({ tone: "warn", message: t("wh.export.empty") });
      return;
    }
    const header = combined
      ? [t("wh.col.item"), t("wh.col.unit"), t("wh.col.parts"), t("wh.col.qty"), t("wh.col.reserved"), t("wh.col.avail")]
      : [t("wh.col.item"), t("wh.col.unit"), t("wh.col.wh"), t("wh.col.qty"), t("wh.col.reserved"), t("wh.col.avail")];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([stockCsv(header, shown, combined ? "combined" : "separate")], { type: "text/csv;charset=utf-8" }));
    a.download = `warehouse-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ tone: "success", message: t("wh.export.done") });
  };

  if (!kind || !allowed) {
    return (
      <div class="ad-page">
        <InlineAlert tone="warn" title={t("wh.noAccess")}>{t("wh.noAccess")}</InlineAlert>
      </div>
    );
  }

  const columns: Column<WhStockRow>[] = [
    { key: "item", header: t("wh.col.item"), cell: (r) => r.itemName, mobile: "title" },
    { key: "unit", header: t("wh.col.unit"), cell: (r) => r.unit ?? "—", mobile: "hide" },
    combined
      ? { key: "parts", header: t("wh.col.parts"), cell: (r) => <span class="wh-parts">{partsText(r, formatNumber)}</span>, mobile: "hide" }
      : { key: "wh", header: t("wh.col.wh"), cell: (r) => r.warehouseName ?? "—" },
    { key: "qty", header: t("wh.col.qty"), cell: (r) => num(r.qty), numeric: true },
    { key: "res", header: t("wh.col.reserved"), cell: (r) => num(r.reserved), numeric: true, mobile: "hide" },
    { key: "avail", header: t("wh.col.avail"), cell: (r) => formatNumber(availOf(r)), numeric: true },
    { key: "status", header: t("wh.col.status"), cell: (r) => { const s = whState(r); return <StatusPill tone={TONE[s]}>{t(`wh.state.${s}` as CopyKey)}</StatusPill>; } },
  ];

  const itemsPanel = (
    <>
      <div class="inv-stats">
        <Stat label={t("wh.stat.items")} value={formatNumber(counts.items)} />
        <Stat label={t("wh.stat.low")} value={formatNumber(counts.low)} tone={counts.low ? "warn" : "neutral"} />
        <Stat label={t("wh.stat.out")} value={formatNumber(counts.out)} tone={counts.out ? "danger" : "neutral"} />
      </div>
      <FilterBar search={search} onSearch={setSearch} searchLabel={t("wh.search")} activeCount={0} onClear={() => setSearch("")}>
        {wh === "all" ? (
          <div class="wh-pills" role="group" aria-label={t("wh.mode.label")}>
            <Button size="sm" variant={mode === "separate" ? "primary" : "secondary"} onClick={() => setMode("separate")}>{t("wh.mode.separate")}</Button>
            <Button size="sm" variant={mode === "combined" ? "primary" : "secondary"} onClick={() => setMode("combined")}>{t("wh.mode.combined")}</Button>
          </div>
        ) : null}
        <Button size="sm" variant="secondary" onClick={exportCsv}>{t("wh.export")}</Button>
      </FilterBar>
      {combined ? <p class="inv-muted">{t("wh.mode.note")}</p> : null}
      {stock.error ? (
        <InlineAlert tone="danger" title={t("wh.loadFail")} action={<Button size="sm" variant="secondary" onClick={() => void stock.refetch()}>{t("wh.retry")}</Button>}>
          {stock.error.message}
        </InlineAlert>
      ) : null}
      <DataTable
        columns={columns}
        rows={shown}
        rowKey={(r) => `${r.itemId}-${r.warehouseId ?? "all"}`}
        caption={t(`wh.title.${kind}` as CopyKey)}
        loading={stock.loading}
        empty={<EmptyState title={t(wh === "all" ? "wh.empty" : "wh.empty.one")} compact />}
      />
    </>
  );

  const listPanel = (
    <div class="wh-cards">
      {mine.map((w) => (
        <WarehouseCard key={w.id} w={w} canManage={!!dto?.canManage} onOpen={() => navigate(`/staff/warehouses?kind=${kind}&wh=${w.id}`)} />
      ))}
    </div>
  );

  return (
    <div class="ad-page">
      <h1 class="ad-title">{cur ? cur.name : t(`wh.title.${kind}` as CopyKey)}</h1>
      <p class="st-login__sub">{t(`wh.sub.${kind}` as CopyKey)}</p>
      {list.error ? (
        <InlineAlert tone="danger" title={t("wh.loadFail")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("wh.retry")}</Button>}>
          {list.error.message}
        </InlineAlert>
      ) : null}
      <div class="wh-bar">
        {cur ? <Button size="sm" variant="ghost" onClick={() => navigate(`/staff/warehouses?kind=${kind}&wh=all`)}>{t("wh.back")}</Button> : null}
        {dto?.canManage && !cur ? <Button icon={Plus} onClick={() => setDlg("new")}>{t("wh.new")}</Button> : null}
        {dto?.canManage && cur ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setDlg("edit")}>{t("wh.rename")}</Button>
            <Button size="sm" variant="secondary" onClick={() => setDlg("keepers")}>{t("wh.keepers.edit")}</Button>
            {!cur.isDefault ? <Button size="sm" variant={cur.active ? "danger" : "secondary"} onClick={() => (cur.active ? setDlg("stop") : void toggleActive())}>{t(cur.active ? "wh.stop" : "wh.resume")}</Button> : null}
          </>
        ) : null}
      </div>
      {cur ? (
        <div class="wh-pills">
          {cur.isDefault ? <StatusPill tone="info">{t("wh.badge.default")}</StatusPill> : null}
          {!cur.active ? <StatusPill tone="neutral">{t("wh.badge.inactive")}</StatusPill> : null}
          <p class="wh-meta">{t("wh.code")}: {cur.code}{dto?.canManage ? ` • ${t("wh.keepers")}: ${keepersText(cur)}` : ""}</p>
        </div>
      ) : null}
      {cur?.isDefault ? <p class="inv-muted">{t("wh.default.hint")}</p> : null}
      {wh === "all" ? (
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "items", label: t("wh.tab.items"), panel: itemsPanel }, { id: "list", label: t("wh.tab.list"), panel: listPanel }]} />
      ) : (
        itemsPanel
      )}
      {dlg === "new" ? <NameDialog kind={kind} onClose={() => setDlg(null)} onDone={(id) => { after(); navigate(`/staff/warehouses?kind=${kind}&wh=${id}`); }} /> : null}
      {dlg === "edit" && cur ? <NameDialog kind={kind} wh={cur} onClose={() => setDlg(null)} onDone={after} /> : null}
      {dlg === "keepers" && cur ? <KeepersDialog wh={cur} onClose={() => setDlg(null)} onDone={after} /> : null}
      {cur ? <ConfirmDialog open={dlg === "stop"} danger loading={act.busy} onClose={() => setDlg(null)} onConfirm={() => void toggleActive()} title={t("wh.stop.title", { n: cur.name })} description={t("wh.stop.desc")} confirmLabel={t("wh.stop")} /> : null}
    </div>
  );
}
