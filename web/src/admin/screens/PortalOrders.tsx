import { useMemo } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Button, Column, DataTable, EmptyState, FilterBar, InlineAlert, Pagination, Select, StatusPill, type Tone } from "../../design/components";
import { navigate } from "../../app/router";
import { useQuery } from "../../api/hooks";
import { formatMoney, formatNumber, formatRelative } from "../../lib/format";
import { api } from "../api";
import { useUrlParams } from "../lib";
import type { OrdList, OrdRow, OrdStatus, PriceInquiryRow } from "../types";
import { OrderDrawer } from "./OrderDrawer";
import { PriceInquiries } from "./PriceInquiries";

const CHIPS = ["pending", "confirmed", "rejected", "cancelled", "all"] as const;
const BASE = "/admin/portal-orders";

export const ordTone = (s: OrdStatus): Tone => (s === "confirmed" ? "success" : s === "rejected" ? "danger" : s === "cancelled" ? "neutral" : "info");
export const ordLabel = (s: string) => t(`a.po.status.${s}` as CopyKey);

export function OrdStatusPill({ r }: { r: OrdRow }) {
  return (
    <div class="ad-pillrow">
      <StatusPill tone={ordTone(r.status)}>{ordLabel(r.status)}</StatusPill>
      {r.progress ? <StatusPill tone="info">{t(`a.po.stage.${r.progress}` as CopyKey)}</StatusPill> : null}
      {r.status === "pending" && (r.sla === "late" || r.sla === "warn") ? <StatusPill tone={r.sla === "late" ? "danger" : "warn"}>{t(`a.ap.sla.${r.sla}` as CopyKey)}</StatusPill> : null}
      {r.lateCancel ? <StatusPill tone="warn">{t("a.po.lateCancel")}</StatusPill> : null}
    </div>
  );
}

export function PortalOrdersPage({ openRef }: { openRef?: string }) {
  const url = useUrlParams();
  const sp = url.get("status", "pending");
  const status = (CHIPS as readonly string[]).includes(sp) ? sp : "pending";
  const q = url.get("q");
  const age = url.get("age");
  const page = Math.max(1, Number(url.get("page", "1")) || 1);
  const query = { q, status, age, page, pageSize: 25 };

  const tab = url.get("tab") === "inquiries" ? "inquiries" : "orders";
  const list = useQuery((signal) => api.get<OrdList>("/portal-admin/orders", { query, signal }), [JSON.stringify(query)]);
  // طلبات الأسعار بتتحمّل هنا (مش جوّه التبويب) عشان العدّاد يظهر على التبويب حتى وانت في تبويب الطلبات.
  const inquiries = useQuery((signal) => api.get<PriceInquiryRow[]>("/price-inquiries/pending", { signal }), []);
  const counts = list.data?.counts;
  const chipCount = (c: string) => (!counts ? null : c === "all" ? counts.pending + counts.confirmed + counts.rejected + counts.cancelled : counts[c as OrdStatus]);
  const activeCount = [q, age].filter(Boolean).length;
  const clearAll = () => url.set({ q: "", age: "", page: "" });

  const columns: Column<OrdRow>[] = useMemo(
    () => [
      { key: "ref", header: t("a.po.col.ref"), mobile: "title", cell: (r) => <bdi dir="ltr">{r.batchRef}</bdi> },
      { key: "customer", header: t("a.po.col.customer"), cell: (r) => (
        <div>
          <strong>{r.customerName}</strong>
          <div class="ad-muted"><bdi dir="ltr">{r.customerPhone}</bdi></div>
        </div>
      ) },
      { key: "status", header: t("a.po.col.status"), cell: (r) => <OrdStatusPill r={r} /> },
      { key: "lines", header: t("a.po.col.lines"), cell: (r) => t("a.po.lines", { n: formatNumber(r.lines) }) },
      { key: "total", header: t("a.po.col.total"), cell: (r) => formatMoney(Number(r.referenceTotal)) },
      { key: "age", header: t("a.po.col.age"), cell: (r) => formatRelative(r.submittedAt) },
    ],
    [],
  );

  const empty = <EmptyState title={activeCount ? t("a.po.empty.filtered") : t("a.po.empty")} action={activeCount ? <Button variant="secondary" onClick={clearAll}>{t("common.clearFilters")}</Button> : undefined} />;

  return (
    <div class="ad-page">
      <header class="ad-head">
        <div>
          <h1 class="ad-title">{t("a.po.title")}</h1>
          <p class="ad-muted">{tab === "inquiries" ? (inquiries.data ? t("a.pi.count", { n: inquiries.data.length }) : t("common.loading")) : list.data ? t("a.po.count", { n: list.data.total }) : t("common.loading")}</p>
        </div>
      </header>

      <div class="ad-chips" role="group" aria-label={t("a.po.title")}>
        <button type="button" class="ad-chip" aria-pressed={tab === "orders"} onClick={() => url.set({ tab: "", q: "" }, { resetPage: true })}>
          {t("a.po.tab.orders")}
        </button>
        <button type="button" class="ad-chip" aria-pressed={tab === "inquiries"} onClick={() => url.set({ tab: "inquiries", q: "" }, { resetPage: true })}>
          {t("a.po.tab.inquiries")}
          {inquiries.data ? <span class="num"> ({formatNumber(inquiries.data.length)})</span> : null}
        </button>
      </div>

      {tab === "orders" ? (
        <>
        <div class="ad-chips" role="group" aria-label={t("a.chips.label")}>
          {CHIPS.map((c) => (
            <button key={c} type="button" class="ad-chip" aria-pressed={status === c} onClick={() => url.set({ status: c === "pending" ? "" : c }, { resetPage: true })}>
              {ordLabel(c)}
              {chipCount(c) != null ? <span class="num"> ({formatNumber(chipCount(c)!)})</span> : null}
            </button>
          ))}
        </div>

        <FilterBar search={q} onSearch={(v) => url.set({ q: v }, { resetPage: true })} searchLabel={t("a.po.search")} activeCount={activeCount} onClear={clearAll}>
          <Select
            aria-label={t("a.po.f.age")}
            value={age}
            options={[
              { value: "", label: t("a.po.f.age.any") },
              { value: "warn", label: t("a.po.f.age.warn") },
              { value: "late", label: t("a.po.f.age.late") },
            ]}
            onChange={(e) => url.set({ age: (e.currentTarget as HTMLSelectElement).value }, { resetPage: true })}
          />
        </FilterBar>

        {list.error ? (
          <InlineAlert tone="danger" title={t("a.po.err.load")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>}>
            {list.error.message}
          </InlineAlert>
        ) : null}

        <DataTable columns={columns} rows={list.data?.items ?? []} rowKey={(r) => r.batchRef} caption={t("a.po.caption")} loading={list.loading} empty={empty} onRowClick={(r) => navigate(`${BASE}/${encodeURIComponent(r.batchRef)}${url.search}`)} />
        <Pagination page={page} pageSize={25} total={list.data?.total ?? 0} onPage={(p) => url.set({ page: p === 1 ? "" : String(p) })} />

        </>
      ) : (
        <>
          <FilterBar search={q} onSearch={(v) => url.set({ q: v })} searchLabel={t("a.pi.search")} activeCount={0} onClear={() => url.set({ q: "" })} />
          <PriceInquiries list={inquiries} search={q} />
        </>
      )}

      {tab === "orders" && openRef ? <OrderDrawer batchRef={openRef} onClose={() => navigate(`${BASE}${url.search}`)} onChanged={() => void list.refetch()} /> : null}
    </div>
  );
}
