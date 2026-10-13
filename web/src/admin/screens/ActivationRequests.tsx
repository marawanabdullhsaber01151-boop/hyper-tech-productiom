import { useMemo } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Button, Column, DataTable, EmptyState, FilterBar, Icon, InlineAlert, Pagination, Select, StatusPill, type Tone } from "../../design/components";
import { Settings } from "../../design/icons";
import { Link, navigate } from "../../app/router";
import { useQuery } from "../../api/hooks";
import { formatNumber, formatRelative } from "../../lib/format";
import { api } from "../api";
import { useUrlParams } from "../lib";
import type { ActList, ActMeta, ActRow, ActStatus } from "../types";
import { ActivationDrawer } from "./ActivationDrawer";

const CHIPS = ["pending", "confirmed", "rejected", "closed", "all"] as const;
const BASE = "/admin/portal-activation-requests";

export const actTone = (s: ActStatus): Tone => (s === "confirmed" ? "success" : s === "rejected" ? "danger" : s === "closed" ? "neutral" : "info");
export const slaTone = (s: ActRow["sla"]): Tone => (s === "late" ? "danger" : "warn");
export const actLabel = (s: string) => t(`a.ac.status.${s}` as CopyKey);

export function ActStatusPill({ r }: { r: ActRow }) {
  return (
    <div class="ad-pillrow">
      <StatusPill tone={actTone(r.status)}>{actLabel(r.status)}</StatusPill>
      {r.status === "pending" && (r.sla === "late" || r.sla === "warn") ? <StatusPill tone={slaTone(r.sla)}>{t(`a.ap.sla.${r.sla}` as CopyKey)}</StatusPill> : null}
      {r.requestCount > 1 ? <StatusPill tone="warn">{t("a.ac.times", { n: formatNumber(r.requestCount) })}</StatusPill> : null}
    </div>
  );
}

export function ActivationRequestsPage({ openId }: { openId?: number }) {
  const url = useUrlParams();
  const sp = url.get("status", "pending");
  const status = (CHIPS as readonly string[]).includes(sp) ? sp : "pending";
  const q = url.get("q");
  const reviewer = url.get("reviewer");
  const age = url.get("age");
  const page = Math.max(1, Number(url.get("page", "1")) || 1);
  const query = { q, status, reviewer, age, page, pageSize: 25 };

  const meta = useQuery((signal) => api.get<ActMeta>("/portal-admin/activation-requests/meta", { signal }), []);
  const list = useQuery((signal) => api.get<ActList>("/portal-admin/activation-requests", { query, signal }), [JSON.stringify(query)]);
  const rows = list.data?.items ?? [];
  const counts = list.data?.counts;
  const chipCount = (c: string) => (!counts ? null : c === "all" ? counts.pending + counts.confirmed + counts.rejected + counts.closed : counts[c as ActStatus]);
  const activeCount = [q, reviewer, age].filter(Boolean).length;
  const open = (r: ActRow) => navigate(`${BASE}/${r.id}${url.search}`);
  const clearAll = () => url.set({ q: "", reviewer: "", age: "", page: "" });

  const columns: Column<ActRow>[] = useMemo(
    () => [
      { key: "company", header: t("a.ac.col.company"), mobile: "title", cell: (r) => (
        <div>
          <strong>{r.companyNameEntered}</strong>
          <div class="ad-muted"><bdi dir="ltr">{r.phoneEntered}</bdi></div>
        </div>
      ) },
      { key: "match", header: t("a.ac.col.match"), cell: (r) => (r.matchedContact ? <div><strong>{r.matchedContact.name}</strong><div class="ad-muted">{r.matchedContact.company ?? ""}</div></div> : <span class="ad-muted">{t("a.ac.noMatch")}</span>) },
      { key: "status", header: t("a.ac.col.status"), cell: (r) => <ActStatusPill r={r} /> },
      { key: "reviewer", header: t("a.ac.col.reviewer"), cell: (r) => r.assignedReviewerName ?? <span class="ad-muted">{t("a.ap.noReviewer")}</span> },
      { key: "age", header: t("a.ac.col.age"), cell: (r) => formatRelative(r.createdAt) },
    ],
    [],
  );

  const empty = <EmptyState title={activeCount ? t("a.ac.empty.filtered") : t("a.ac.empty")} action={activeCount ? <Button variant="secondary" onClick={clearAll}>{t("common.clearFilters")}</Button> : undefined} />;

  return (
    <div class="ad-page">
      <header class="ad-head">
        <div>
          <h1 class="ad-title">{t("a.ac.title")}</h1>
          <p class="ad-muted">{list.data ? t("a.ac.count", { n: list.data.total }) : t("common.loading")}</p>
        </div>
        <div class="ad-row">
          <Link to="/admin/portal-customers/settings" class="ht-btn ht-btn--secondary"><Icon icon={Settings} size={18} /><span class="ht-btn__label">{t("a.ac.settings")}</span></Link>
        </div>
      </header>

      <div class="ad-chips" role="group" aria-label={t("a.chips.label")}>
        {CHIPS.map((c) => (
          <button key={c} type="button" class="ad-chip" aria-pressed={status === c} onClick={() => url.set({ status: c === "pending" ? "" : c }, { resetPage: true })}>
            {actLabel(c)}
            {chipCount(c) != null ? <span class="num"> ({formatNumber(chipCount(c)!)})</span> : null}
          </button>
        ))}
      </div>

      <FilterBar search={q} onSearch={(v) => url.set({ q: v }, { resetPage: true })} searchLabel={t("a.ac.search")} activeCount={activeCount} onClear={clearAll}>
        <Select
          aria-label={t("a.ac.f.reviewer")}
          value={reviewer}
          options={[
            { value: "", label: t("a.ap.f.reviewer.any") },
            { value: "me", label: t("a.ap.f.reviewer.me") },
            { value: "none", label: t("a.ap.f.reviewer.none") },
            ...(meta.data?.reviewers ?? []).map((u) => ({ value: String(u.id), label: u.fullName })),
          ]}
          onChange={(e) => url.set({ reviewer: (e.currentTarget as HTMLSelectElement).value }, { resetPage: true })}
        />
        <Select
          aria-label={t("a.ac.f.age")}
          value={age}
          options={[
            { value: "", label: t("a.ap.f.age.any") },
            { value: "warn", label: t("a.ap.f.age.warn") },
            { value: "late", label: t("a.ap.f.age.late") },
          ]}
          onChange={(e) => url.set({ age: (e.currentTarget as HTMLSelectElement).value }, { resetPage: true })}
        />
      </FilterBar>

      {list.error ? (
        <InlineAlert tone="danger" title={t("a.ac.err.load")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>}>
          {list.error.message}
        </InlineAlert>
      ) : null}

      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("a.ac.caption")} loading={list.loading} empty={empty} onRowClick={open} />
      <Pagination page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => url.set({ page: p === 1 ? "" : String(p) })} />

      {openId ? <ActivationDrawer id={openId} meta={meta.data} onClose={() => navigate(`${BASE}${url.search}`)} onChanged={() => void list.refetch()} /> : null}
    </div>
  );
}
