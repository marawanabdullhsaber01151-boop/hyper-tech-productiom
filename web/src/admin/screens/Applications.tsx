import { useMemo, useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Button, Checkbox, Column, Icon, DataTable, EmptyState, FilterBar, InlineAlert, Pagination, Select, StatusPill, type Tone } from "../../design/components";
import { Download, Settings } from "../../design/icons";
import { Link, navigate } from "../../app/router";
import { useQuery } from "../../api/hooks";
import { formatNumber, formatRelative } from "../../lib/format";
import { api, downloadCsv } from "../api";
import { readJson, useUrlParams, writeJson } from "../lib";
import type { AppList, AppMeta, AppRow, AppSla, AppStage } from "../types";
import { ApplicationDrawer } from "./ApplicationDrawer";

const STAGE_CHIPS = ["open", "new", "ready", "needs_info", "approved", "rejected", "duplicate_auto_closed"] as const;
const COLUMN_STAGES: AppStage[] = ["new", "ready", "needs_info"];
const VIEW_KEY = "ht_apps_view";
const BASE = "/admin/portal-applications";

export const stageTone = (s: AppStage): Tone => (s === "approved" ? "success" : s === "rejected" || s === "duplicate_auto_closed" ? "danger" : s === "needs_info" ? "warn" : s === "ready" ? "brand" : "info");
export const slaTone = (s: AppSla): Tone => (s === "late" ? "danger" : s === "warn" ? "warn" : s === "done" ? "neutral" : "success");
export const stageLabel = (s: string) => t(`a.ap.stage.${s}` as CopyKey);

export function StagePill({ stage }: { stage: AppStage }) {
  return <StatusPill tone={stageTone(stage)}>{stageLabel(stage)}</StatusPill>;
}
export function SlaPill({ sla }: { sla: AppSla }) {
  if (sla === "ok" || sla === "done") return null;
  return <StatusPill tone={slaTone(sla)}>{t(`a.ap.sla.${sla}` as CopyKey)}</StatusPill>;
}
export function ageText(hours: number) {
  return hours >= 48 ? t("a.ap.age.days", { n: formatNumber(Math.floor(hours / 24)) }) : t("a.ap.age.hours", { n: formatNumber(hours) });
}

export function ApplicationsPage({ openId }: { openId?: number }) {
  const url = useUrlParams();
  const stageParam = url.get("stage", "open");
  const stage = (STAGE_CHIPS as readonly string[]).includes(stageParam) ? stageParam : "open";
  const q = url.get("q");
  const reviewer = url.get("reviewer");
  const age = url.get("age");
  const dup = url.get("dup") === "1";
  const page = Math.max(1, Number(url.get("page", "1")) || 1);
  const [mode, setMode] = useState<"list" | "columns">(() => (readJson<string>(VIEW_KEY, "list") === "columns" ? "columns" : "list"));
  const columnsMode = mode === "columns" && stage === "open";
  const pageSize = columnsMode ? 100 : 25;

  const query = { q, stage, reviewer, age, duplicate: dup ? "1" : undefined, page, pageSize };
  const meta = useQuery((signal) => api.get<AppMeta>("/portal-admin/applications/meta", { signal }), []);
  const list = useQuery((signal) => api.get<AppList>("/portal-admin/applications", { query, signal }), [JSON.stringify(query)]);
  const rows = list.data?.items ?? [];
  const counts = list.data?.counts;
  const chipCount = (c: string) => (!counts ? null : c === "open" ? counts.new + counts.needs_info + counts.ready : counts[c as AppStage]);
  const activeCount = [q, reviewer, age].filter(Boolean).length + (dup ? 1 : 0);
  const open = (r: AppRow) => navigate(`${BASE}/${r.id}${url.search}`);

  const setMode2 = (m: "list" | "columns") => {
    setMode(m);
    writeJson(VIEW_KEY, m);
  };

  const columns: Column<AppRow>[] = useMemo(
    () => [
      { key: "applicant", header: t("a.ap.col.applicant"), mobile: "title", cell: (r) => (
        <div>
          <strong>{r.companyName}</strong>
          <div class="ad-muted">{r.fullName}</div>
        </div>
      ) },
      { key: "phone", header: t("a.ap.col.phone"), cell: (r) => <bdi dir="ltr">{r.phone}</bdi> },
      { key: "complete", header: t("a.ap.col.complete"), numeric: true, cell: (r) => <span class="num">{formatNumber(r.completeness)}%</span> },
      { key: "stage", header: t("a.ap.col.stage"), cell: (r) => (
        <div class="ad-pillrow">
          <StagePill stage={r.stage} />
          <SlaPill sla={r.sla} />
          {r.hasDuplicate ? <StatusPill tone="warn">{t("a.ap.dup")}</StatusPill> : null}
        </div>
      ) },
      { key: "reviewer", header: t("a.ap.col.reviewer"), cell: (r) => r.assignedReviewerName ?? <span class="ad-muted">{t("a.ap.noReviewer")}</span> },
      { key: "age", header: t("a.ap.col.age"), cell: (r) => formatRelative(r.createdAt) },
    ],
    [],
  );

  const clearAll = () => url.set({ q: "", reviewer: "", age: "", dup: "", page: "" });
  const empty = <EmptyState title={activeCount ? t("a.ap.empty.filtered") : t("a.ap.empty")} action={activeCount ? <Button variant="secondary" onClick={clearAll}>{t("common.clearFilters")}</Button> : undefined} />;

  return (
    <div class="ad-page">
      <header class="ad-head">
        <div>
          <h1 class="ad-title">{t("a.ap.title")}</h1>
          <p class="ad-muted">{list.data ? t("a.ap.count", { n: list.data.total }) : t("common.loading")}</p>
        </div>
        <div class="ad-row">
          {stage === "open" ? (
            <div class="ad-chips" role="group" aria-label={t("a.ap.view.label")}>
              <button type="button" class="ad-chip" aria-pressed={mode === "list"} onClick={() => setMode2("list")}>{t("a.ap.view.list")}</button>
              <button type="button" class="ad-chip" aria-pressed={mode === "columns"} onClick={() => setMode2("columns")}>{t("a.ap.view.columns")}</button>
            </div>
          ) : null}
          <Button variant="secondary" icon={Download} onClick={() => void downloadCsv("/portal-admin/applications/export.csv", { ...query, page: undefined, pageSize: undefined }, "applications.csv")}>{t("a.ap.csv")}</Button>
          <Link to="/admin/portal-customers/settings" class="ht-btn ht-btn--secondary"><Icon icon={Settings} size={18} /><span class="ht-btn__label">{t("a.ap.settings")}</span></Link>
        </div>
      </header>

      <div class="ad-chips" role="group" aria-label={t("a.chips.label")}>
        {STAGE_CHIPS.map((c) => (
          <button key={c} type="button" class="ad-chip" aria-pressed={stage === c} onClick={() => url.set({ stage: c === "open" ? "" : c }, { resetPage: true })}>
            {stageLabel(c)}
            {chipCount(c) != null ? <span class="num"> ({formatNumber(chipCount(c)!)})</span> : null}
          </button>
        ))}
      </div>

      <FilterBar search={q} onSearch={(v) => url.set({ q: v }, { resetPage: true })} searchLabel={t("a.ap.search")} activeCount={activeCount} onClear={clearAll}>
        <Select
          aria-label={t("a.ap.f.reviewer")}
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
          aria-label={t("a.ap.f.age")}
          value={age}
          options={[
            { value: "", label: t("a.ap.f.age.any") },
            { value: "warn", label: t("a.ap.f.age.warn") },
            { value: "late", label: t("a.ap.f.age.late") },
          ]}
          onChange={(e) => url.set({ age: (e.currentTarget as HTMLSelectElement).value }, { resetPage: true })}
        />
        <Checkbox label={t("a.ap.f.dup")} checked={dup} onChange={(e) => url.set({ dup: (e.currentTarget as HTMLInputElement).checked ? "1" : "" }, { resetPage: true })} />
      </FilterBar>

      {list.error ? (
        <InlineAlert tone="danger" title={t("a.ap.err.load")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>}>
          {list.error.message}
        </InlineAlert>
      ) : null}

      {columnsMode ? (
        <div class="ad-cols">
          {COLUMN_STAGES.map((s) => {
            const items = rows.filter((r) => r.stage === s);
            return (
              <section class="ad-col" key={s} aria-label={stageLabel(s)}>
                <div class="ad-col__head">
                  <strong>{stageLabel(s)}</strong>
                  <span class="num ad-muted">{formatNumber(items.length)}</span>
                </div>
                {items.length ? items.map((r) => (
                  <article class="ad-appcard" key={r.id}>
                    <strong>{r.companyName}</strong>
                    <span class="ad-muted">{r.fullName} · <bdi dir="ltr">{r.phone}</bdi></span>
                    <div class="ad-pillrow">
                      <StatusPill tone="neutral">{formatNumber(r.completeness)}%</StatusPill>
                      <SlaPill sla={r.sla} />
                      {r.hasDuplicate ? <StatusPill tone="warn">{t("a.ap.dup")}</StatusPill> : null}
                    </div>
                    <span class="ad-muted">{r.assignedReviewerName ?? t("a.ap.noReviewer")} · {ageText(r.ageHours)}</span>
                    <Button size="sm" variant="secondary" onClick={() => open(r)}>{t("a.ap.open")}</Button>
                  </article>
                )) : <p class="ad-muted">{t("a.ap.cols.empty")}</p>}
              </section>
            );
          })}
        </div>
      ) : (
        <>
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("a.ap.caption")} loading={list.loading} empty={empty} onRowClick={open} />
          <Pagination page={page} pageSize={pageSize} total={list.data?.total ?? 0} onPage={(p) => url.set({ page: p === 1 ? "" : String(p) })} />
        </>
      )}

      {openId ? <ApplicationDrawer id={openId} meta={meta.data} onClose={() => navigate(`${BASE}${url.search}`)} onChanged={() => void list.refetch()} /> : null}
    </div>
  );
}
