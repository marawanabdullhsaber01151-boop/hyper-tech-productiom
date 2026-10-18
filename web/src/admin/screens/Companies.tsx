import { useMemo, useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Button, Checkbox, Column, ConfirmDialog, DataTable, Dialog, EmptyState, Field, FilterBar, InlineAlert, Input, Menu, Pagination, Popover, Select, StatusPill, useToast } from "../../design/components";
import { Download, Ellipsis, ListFilter, Settings } from "../../design/icons";
import { Link, navigate } from "../../app/router";
import { useQuery } from "../../api/hooks";
import { formatNumber, formatRelative } from "../../lib/format";
import { api, downloadCsv } from "../api";
import { useAct } from "../act";
import { readJson, useUrlParams, writeJson } from "../lib";
import { HealthBadge, StatusBadge } from "../parts";
import { optLabel } from "../SettingField";
import type { CompanyRow, ListResponse, Meta } from "../types";
import { CompanyDrawer } from "./CompanyDrawer";

const VIEWS = ["all", "not_activated", "active", "suspended", "followup", "nosales", "pendingjoin", "archived"] as const;
type View = (typeof VIEWS)[number];
const OPTIONAL_COLS = ["phone", "segment", "orders", "created"] as const;
const COLS_KEY = "ht_admin_cols";
const VIEWS_KEY = "ht_admin_saved_views";
const SORTS: Record<string, string> = { name: "name", members: "members", lastActivity: "lastActivity", lastOrder: "lastOrder", created: "created" };

function viewQuery(v: View): Record<string, string> {
  if (v === "not_activated" || v === "active" || v === "suspended" || v === "archived") return { status: v };
  if (v === "followup") return { needsFollowUp: "1" };
  if (v === "nosales") return { noSales: "1" };
  if (v === "pendingjoin") return { hasPendingJoin: "1" };
  return {};
}

export function CompaniesPage({ openId, tab }: { openId?: number; tab?: string }) {
  const url = useUrlParams();
  const toast = useToast();
  const { run, busy } = useAct();
  const view = (VIEWS as readonly string[]).includes(url.get("view")) ? (url.get("view") as View) : "all";
  const q = url.get("q");
  const gov = url.get("gov");
  const seg = url.get("seg");
  const sales = url.get("sales");
  const sort = url.get("sort", "created");
  const dir = url.get("dir", "desc") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(url.get("page", "1")) || 1);
  const pageSize = 25;

  const query = { q, ...viewQuery(view), governorate: gov, segment: seg, salesUserId: sales, sort: SORTS[sort] ?? "created", dir, page, pageSize };
  const meta = useQuery((signal) => api.get<Meta>("/portal-companies/meta", { signal }), []);
  const list = useQuery((signal) => api.get<ListResponse>("/portal-companies", { query, signal }), [JSON.stringify(query)]);
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cols, setCols] = useState<string[]>(() => readJson<string[]>(COLS_KEY, []));
  const [saved, setSaved] = useState<Array<{ name: string; qs: string }>>(() => readJson(VIEWS_KEY, []));
  const [dlg, setDlg] = useState<null | "sales" | "segment" | "suspend" | "reactivate" | "saveView">(null);
  const [pick, setPick] = useState("");
  const [viewName, setViewName] = useState("");

  const activeCount = [q, gov, seg, sales].filter(Boolean).length + (view !== "all" ? 1 : 0);
  const toggleSel = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const columns: Column<CompanyRow>[] = useMemo(() => {
    const on = (k: string) => cols.includes(k);
    const base: Column<CompanyRow>[] = [
      { key: "name", header: t("a.col.company"), mobile: "title", sortable: true, cell: (r) => (
        <div class="ad-company" onClick={(e) => e.stopPropagation()}>
          <Checkbox aria-label={t("a.select.row", { name: r.companyName })} label="" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} />
          <div onClick={() => navigate(`/admin/portal-customers/${r.id}${url.search}`)} class="ad-company__txt">
            <strong>{r.companyName}</strong>
            <div class="ad-muted">{r.governorate ?? t("a.none")}</div>
          </div>
        </div>
      ) },
      { key: "owner", header: t("a.col.owner"), cell: (r) => r.ownerName },
      ...(on("phone") ? [{ key: "phone", header: t("a.col.phone"), cell: (r: CompanyRow) => <bdi dir="ltr">{r.phone}</bdi> }] : []),
      { key: "members", header: t("a.col.members"), sortable: true, numeric: true, cell: (r) => (
        <span class="num">{formatNumber(r.membersCount)}{r.pendingJoin ? <StatusPill tone="warn">{t("a.pendingJoin", { n: r.pendingJoin })}</StatusPill> : null}</span>
      ) },
      { key: "status", header: t("a.col.status"), cell: (r) => <StatusBadge status={r.status} /> },
      { key: "lastActivity", header: t("a.col.activity"), sortable: true, cell: (r) => (r.lastActivityAt ? formatRelative(r.lastActivityAt) : t("a.never")) },
      { key: "lastOrder", header: t("a.col.lastOrder"), sortable: true, cell: (r) => (r.lastOrderAt ? formatRelative(r.lastOrderAt) : t("a.never")) },
      { key: "sales", header: t("a.col.sales"), cell: (r) => r.salesName ?? <span class="ad-muted">{t("a.col.salesNone")}</span> },
      { key: "health", header: t("a.col.health"), cell: (r) => <HealthBadge level={r.health.level} label={r.health.label} /> },
      ...(on("segment") ? [{ key: "segment", header: t("a.col.segment"), cell: (r: CompanyRow) => (r.segment ? optLabel(r.segment) : t("a.none")) }] : []),
      ...(on("orders") ? [{ key: "orders", header: t("a.col.orders"), numeric: true, cell: (r: CompanyRow) => formatNumber(r.ordersCount) }] : []),
      ...(on("created") ? [{ key: "created", header: t("a.col.created"), sortable: true, cell: (r: CompanyRow) => formatRelative(r.createdAt) }] : []),
    ];
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, selected, url.search]);

  const applyBulk = async (body: Record<string, unknown>, ok: string) => {
    const r = await run(() => api.post("/portal-companies/bulk", { ids: [...selected], ...body }), ok);
    if (r !== undefined) {
      setDlg(null);
      setPick("");
      setSelected(new Set());
      await list.refetch();
    }
  };
  const exportCsv = async (ids?: number[]) => {
    const ok = await downloadCsv("/portal-companies/export.csv", { ...query, page: undefined, pageSize: undefined, ids: ids?.join(",") }, "portal-companies.csv");
    if (!ok) toast({ tone: "danger", message: t("a.csv.failed") });
  };
  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    const next = [...saved.filter((s) => s.name !== name), { name, qs: url.search }].slice(-12);
    setSaved(next);
    writeJson(VIEWS_KEY, next);
    setDlg(null);
    setViewName("");
    toast({ tone: "success", message: t("common.saved") });
  };

  const sortState = { key: sort, dir } as const;
  const empty = (
    <EmptyState title={activeCount ? t("a.empty.filtered") : t("a.empty")} description={activeCount ? t("a.empty.filtered.hint") : undefined} action={activeCount ? <Button variant="secondary" onClick={() => url.set({ q: "", view: "", gov: "", seg: "", sales: "", page: "" })}>{t("common.clearFilters")}</Button> : undefined} />
  );

  return (
    <div class="ad-page">
      <header class="ad-head">
        <div>
          <h1 class="ad-title">{t("a.title")}</h1>
          <p class="ad-muted">{list.data ? t("a.count", { n: total }) : t("common.loading")}</p>
        </div>
        <div class="ad-row">
          <Menu
            label={t("a.views")}
            trigger={({ toggle, open, id }) => <Button variant="secondary" icon={ListFilter} aria-expanded={open} aria-controls={id} onClick={toggle}>{t("a.views")}</Button>}
            items={[
              ...saved.map((s) => ({ label: s.name, onSelect: () => navigate(`/admin/portal-customers${s.qs}`) })),
              { label: t("a.views.save"), onSelect: () => setDlg("saveView") },
              ...saved.map((s) => ({ label: `${t("a.views.remove")}: ${s.name}`, danger: true, onSelect: () => { const n = saved.filter((x) => x.name !== s.name); setSaved(n); writeJson(VIEWS_KEY, n); } })),
            ]}
          />
          <Popover
            label={t("a.cols")}
            trigger={({ toggle, open, id }) => <Button variant="secondary" aria-expanded={open} aria-controls={id} onClick={toggle}>{t("a.cols")}</Button>}
          >
            <div class="ad-stack ad-pop">
              {OPTIONAL_COLS.map((c) => (
                <Checkbox key={c} label={t(`a.col.${c}` as CopyKey)} checked={cols.includes(c)} onChange={(e) => { const n = (e.currentTarget as HTMLInputElement).checked ? [...cols, c] : cols.filter((x) => x !== c); setCols(n); writeJson(COLS_KEY, n); }} />
              ))}
            </div>
          </Popover>
          <Button variant="secondary" icon={Download} onClick={() => void exportCsv()}>{t("a.csv")}</Button>
          <Link to="/admin/portal-customers/settings" class="ht-btn ht-btn--secondary"><span class="ht-btn__label">{t("a.settings")}</span></Link>
        </div>
      </header>

      <div class="ad-chips" role="group" aria-label={t("a.chips.label")}>
        {VIEWS.map((v) => (
          <button key={v} type="button" class="ad-chip" aria-pressed={view === v} onClick={() => url.set({ view: v === "all" ? "" : v }, { resetPage: true })}>
            {t(`a.view.${v}` as CopyKey)}
          </button>
        ))}
      </div>

      <FilterBar search={q} onSearch={(v) => url.set({ q: v }, { resetPage: true })} searchLabel={t("a.search")} activeCount={activeCount} onClear={() => url.set({ q: "", view: "", gov: "", seg: "", sales: "" }, { resetPage: true })}>
        <Select aria-label={t("a.f.gov")} value={gov} placeholder={t("a.f.gov")} options={[{ value: "", label: t("a.f.any") }, ...(meta.data?.governorates ?? []).map((g) => ({ value: g, label: g }))]} onChange={(e) => url.set({ gov: (e.currentTarget as HTMLSelectElement).value }, { resetPage: true })} />
        <Select aria-label={t("a.f.segment")} value={seg} placeholder={t("a.f.segment")} options={[{ value: "", label: t("a.f.any") }, ...(meta.data?.segments ?? []).map((s) => ({ value: s, label: optLabel(s) }))]} onChange={(e) => url.set({ seg: (e.currentTarget as HTMLSelectElement).value }, { resetPage: true })} />
        <Select aria-label={t("a.f.sales")} value={sales} placeholder={t("a.f.sales")} options={[{ value: "", label: t("a.f.any") }, ...(meta.data?.salesUsers ?? []).map((u) => ({ value: String(u.id), label: u.fullName }))]} onChange={(e) => url.set({ sales: (e.currentTarget as HTMLSelectElement).value }, { resetPage: true })} />
      </FilterBar>

      {selected.size ? (
        <div class="ad-bulk" role="region" aria-label={t("a.bulk.label")}>
          <strong class="num">{t("a.bulk.count", { n: selected.size })}</strong>
          <div class="ad-row">
            <Button size="sm" variant="secondary" onClick={() => setDlg("sales")}>{t("a.bulk.sales")}</Button>
            <Button size="sm" variant="secondary" onClick={() => setDlg("segment")}>{t("a.bulk.segment")}</Button>
            <Button size="sm" variant="secondary" icon={Download} onClick={() => void exportCsv([...selected])}>{t("a.bulk.csv")}</Button>
            <Menu
              label={t("a.bulk.more")}
              trigger={({ toggle, open, id }) => <Button size="sm" variant="secondary" icon={Ellipsis} aria-expanded={open} aria-controls={id} onClick={toggle}>{t("a.bulk.more")}</Button>}
              items={[
                { label: t("a.bulk.suspend"), danger: true, onSelect: () => setDlg("suspend") },
                { label: t("a.bulk.reactivate"), onSelect: () => setDlg("reactivate") },
              ]}
            />
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t("a.bulk.clear")}</Button>
          </div>
        </div>
      ) : rows.length ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))}>{allOnPage ? t("a.select.none") : t("a.select.page")}</Button>
        </div>
      ) : null}

      {list.error ? (
        <InlineAlert tone="danger" title={t("a.err.load")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>}>
          {list.error.message}
        </InlineAlert>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption={t("a.caption")}
        loading={list.loading}
        empty={empty}
        sort={sortState}
        onSort={(s) => url.set(s ? { sort: s.key, dir: s.dir } : { sort: "", dir: "" })}
        onRowClick={(r) => navigate(`/admin/portal-customers/${r.id}${url.search}`)}
      />
      <Pagination page={page} pageSize={pageSize} total={total} onPage={(p) => url.set({ page: p === 1 ? "" : String(p) })} />

      {openId ? <CompanyDrawer id={openId} tab={tab ?? "overview"} search={url.search} onClose={() => navigate(`/admin/portal-customers${url.search}`)} onListChanged={() => void list.refetch()} /> : null}

      <Dialog open={dlg === "sales"} onClose={() => setDlg(null)} title={t("a.bulk.sales.title", { n: selected.size })} footer={<><Button variant="ghost" onClick={() => setDlg(null)}>{t("common.cancel")}</Button><Button loading={busy} onClick={() => void applyBulk({ action: "assignSales", salesUserId: pick ? Number(pick) : null }, t("common.saved"))}>{t("common.save")}</Button></>}>
        <Field label={t("a.f.sales")}>
          <Select value={pick} options={[{ value: "", label: t("a.ov.salesNone") }, ...(meta.data?.salesUsers ?? []).map((u) => ({ value: String(u.id), label: u.fullName }))]} onChange={(e) => setPick((e.currentTarget as HTMLSelectElement).value)} />
        </Field>
      </Dialog>
      <Dialog open={dlg === "segment"} onClose={() => setDlg(null)} title={t("a.bulk.segment.title", { n: selected.size })} footer={<><Button variant="ghost" onClick={() => setDlg(null)}>{t("common.cancel")}</Button><Button loading={busy} disabled={!pick} onClick={() => void applyBulk({ action: "segment", segment: pick }, t("common.saved"))}>{t("common.save")}</Button></>}>
        <Field label={t("a.f.segment")}>
          <Select value={pick} placeholder={t("a.ov.segmentNone")} options={(meta.data?.segments ?? []).map((s) => ({ value: s, label: optLabel(s) }))} onChange={(e) => setPick((e.currentTarget as HTMLSelectElement).value)} />
        </Field>
      </Dialog>
      <ConfirmDialog open={dlg === "suspend"} onClose={() => setDlg(null)} loading={busy} danger title={t("a.bulk.suspend.title", { n: selected.size })} description={t("a.bulk.suspend.body")} confirmLabel={t("a.bulk.suspend.ok")} onConfirm={() => applyBulk({ action: "status", status: "suspend" }, t("a.done"))} />
      <ConfirmDialog open={dlg === "reactivate"} onClose={() => setDlg(null)} loading={busy} title={t("a.bulk.reactivate.title", { n: selected.size })} confirmLabel={t("a.bulk.reactivate.ok")} onConfirm={() => applyBulk({ action: "status", status: "reactivate" }, t("a.done"))} />
      <Dialog open={dlg === "saveView"} onClose={() => setDlg(null)} title={t("a.views.save")} footer={<><Button variant="ghost" onClick={() => setDlg(null)}>{t("common.cancel")}</Button><Button disabled={!viewName.trim()} onClick={saveView}>{t("common.save")}</Button></>}>
        <Field label={t("a.views.name")}><Input value={viewName} onInput={(e) => setViewName((e.currentTarget as HTMLInputElement).value)} /></Field>
      </Dialog>
    </div>
  );
}
