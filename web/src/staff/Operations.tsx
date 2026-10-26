import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { navigate } from "../app/router";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, FilterBar, InlineAlert, Input, Pagination, Select, Skeleton, Stat, Tabs, type Column } from "../design/components";
import { CircleCheck, Plus, RefreshCw, TriangleAlert } from "../design/icons";
import { formatDate, formatNumber, formatRelative } from "../lib/format";
import { OperationsCase } from "./OperationsCase";
import { OperationsQueues } from "./OperationsQueues";
import { OperationsCapacity } from "./OperationsCapacity";
import { OperationsPlans } from "./OperationsPlans";
import { OperationsTransfers } from "./OperationsTransfers";
import { CaseStatusPill, PriorityPill, ReasonChips, RiskPill } from "./OperationsParts";
import { CASE_STATUSES, PRIORITIES, focusOf, pipelineSegments, type Kpis, type Overview, type RiskLevel } from "./operationsCore";
import { OPERATIONS_ROLES } from "./staffRoles";
import "./Operations.css";

export { OPERATIONS_ROLES };

interface CaseRow {
  id: number;
  caseNumber: string;
  salesOrderNumber: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignedTo: number | null;
  customerDisplayName: string | null;
  lineCount: number;
  riskLevel: RiskLevel;
  overdue: boolean;
}
interface CasesPage {
  items: CaseRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
interface Filters {
  status: string;
  priority: string;
  risk: string;
  assignee: string;
  search: string;
}
const NO_FILTERS: Filters = { status: "", priority: "", risk: "", assignee: "", search: "" };
const PAGE_SIZE = 15;
const TABS = ["overview", "cases", "claim", "plans", "transfers", "capacity", "needs"] as const;
type Tab = (typeof TABS)[number];
const val = (e: Event) => (e.target as HTMLInputElement).value;

/** مركز قيادة التشغيل: نظرة عامة بالمخاطر والمهل، صندوق الحالات، استلام أوامر الإنتاج، والاحتياجات والاستثناءات. */
export function Operations() {
  const qs = new URLSearchParams(location.search);
  const startTab = qs.get("tab");
  const [tab, setTab] = useState<Tab>(() => ((TABS as readonly string[]).includes(startTab ?? "") ? (startTab as Tab) : "overview"));
  const [openId, setOpenId] = useState<number | null>(() => Number(qs.get("case")) || null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [intake, setIntake] = useState(false);

  const overview = useQuery((signal) => api.get<Overview>("/operations-center/overview", { signal }), []);
  const o = overview.data;

  const go = (next: Tab, f: Partial<Filters> = {}) => {
    setFilters({ ...NO_FILTERS, ...f });
    setPage(1);
    setTab(next);
  };
  const changed = () => void overview.refetch();

  const tabs = [
    { id: "overview", label: t("opc.tab.overview"), panel: <OverviewPanel o={o} error={overview.error?.message} onRetry={() => void overview.refetch()} go={go} onOpen={setOpenId} /> },
    {
      id: "cases",
      label: t("opc.tab.cases"),
      badge: o?.kpis.activeCases || undefined,
      panel: <CasesPanel filters={filters} setFilters={(f) => { setFilters(f); setPage(1); }} page={page} setPage={setPage} team={o?.team ?? []} onOpen={setOpenId} onIntake={() => setIntake(true)} refreshKey={o?.generatedAt} />,
    },
    { id: "claim", label: t("opc.tab.claim"), badge: o?.kpis.awaitingClaim || undefined, panel: <OperationsQueues part="claim" onChanged={changed} /> },
    { id: "plans", label: t("opc.tab.plans"), panel: <OperationsPlans onChanged={changed} /> },
    { id: "transfers", label: t("opc.tab.transfers"), badge: o?.kpis.transfersPending || undefined, panel: <OperationsTransfers onChanged={changed} /> },
    { id: "capacity", label: t("opc.tab.capacity"), panel: <OperationsCapacity /> },
    { id: "needs", label: t("opc.tab.needs"), badge: o ? o.kpis.requisitionsPending + o.kpis.exceptionsOpen || undefined : undefined, panel: <OperationsQueues part="needs" onChanged={changed} /> },
  ];

  return (
    <div class="ad-page">
      <div class="opc-top">
        <div>
          <h1 class="ad-title">{t("opc.title")}</h1>
          <p class="st-login__sub">{t("opc.subtitle")}</p>
        </div>
        <div class="opc-top__actions">
          <Button icon={Plus} onClick={() => setIntake(true)}>{t("opc.intake.btn")}</Button>
          <Button variant="secondary" icon={RefreshCw} loading={overview.loading} onClick={() => void overview.refetch()}>{t("opc.refresh")}</Button>
        </div>
      </div>
      {o ? <p class="opc-muted">{t("opc.updated", { when: formatRelative(o.generatedAt) })}</p> : null}
      <Tabs value={tab} onChange={(v) => setTab(v as Tab)} tabs={tabs} />
      {openId !== null ? <OperationsCase id={openId} onClose={() => setOpenId(null)} onChanged={changed} /> : null}
      {intake ? (
        <IntakeDialog
          onClose={() => setIntake(false)}
          onDone={(id) => {
            setIntake(false);
            setOpenId(id);
            changed();
          }}
        />
      ) : null}
    </div>
  );
}

function OverviewPanel({ o, error, onRetry, go, onOpen }: { o: Overview | undefined; error?: string; onRetry: () => void; go: (tab: Tab, f?: Partial<Filters>) => void; onOpen: (id: number) => void }) {
  if (error && !o) return <InlineAlert tone="danger" title={t("opc.err")} action={<Button size="sm" variant="secondary" onClick={onRetry}>{t("common.retry")}</Button>}>{error}</InlineAlert>;
  if (!o) return <Skeleton height={260} radius="var(--r-md)" />;
  const k = o.kpis;
  const focus = focusOf(k);
  const segs = pipelineSegments(o.byStatus);
  const maxLoad = Math.max(1, ...o.team.map((m) => m.activeCases));
  const stat = (key: keyof Kpis, label: CopyKey, tone: "neutral" | "danger" | "warn" | "success" | "brand", to?: () => void) => (
    <div
      class={to ? "opc-stat opc-stat--link" : "opc-stat"}
      role={to ? "button" : undefined}
      tabIndex={to ? 0 : undefined}
      onClick={to}
      onKeyDown={(e) => {
        if (to && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          to();
        }
      }}
      aria-label={`${t(label)}: ${formatNumber(k[key])}`}
    >
      <Stat label={t(label)} value={formatNumber(k[key])} tone={k[key] > 0 ? tone : "neutral"} />
    </div>
  );

  return (
    <div class="opc-over">
      <section class={`opc-focus opc-focus--${focus.kind === "calm" ? "calm" : focus.kind === "sla" ? "danger" : "brand"}`} aria-live="polite">
        {focus.kind === "calm" ? <CircleCheck size={22} aria-hidden="true" /> : <TriangleAlert size={22} aria-hidden="true" />}
        <div>
          <strong>{t(`opc.focus.${focus.kind}` as CopyKey, { n: formatNumber(focus.count) })}</strong>
          <span class="opc-muted">{t(`opc.focus.${focus.kind}.hint` as CopyKey)}</span>
        </div>
        {focus.kind !== "calm" ? (
          <Button
            size="sm"
            onClick={() => {
              if (focus.kind === "sla") go("cases", { risk: "high" });
              else if (focus.kind === "convert") go("cases", { status: "analysis_ready" });
              else if (focus.kind === "claim") go("claim");
              else if (focus.kind === "exceptions" || focus.kind === "requisitions") go("needs");
              else if (focus.kind === "waiting") go("cases", { status: "needs_sales_clarification" });
              else go("cases");
            }}
          >
            {t("opc.focus.go")}
          </Button>
        ) : null}
      </section>

      <div class="opc-stats">
        {stat("activeCases", "opc.k.active", "brand", () => go("cases"))}
        {stat("atRisk", "opc.k.risk", "danger", () => go("cases", { risk: "high" }))}
        {stat("slaBreached", "opc.k.sla", "danger", () => go("cases", { risk: "high" }))}
        {stat("waitingSales", "opc.k.waiting", "warn", () => go("cases", { status: "needs_sales_clarification" }))}
        {stat("readyToConvert", "opc.k.ready", "success", () => go("cases", { status: "analysis_ready" }))}
        {stat("awaitingClaim", "opc.k.claim", "warn", () => go("claim"))}
        {stat("requisitionsPending", "opc.k.reqs", "warn", () => go("needs"))}
        {stat("exceptionsOpen", "opc.k.exc", "danger", () => go("needs"))}
        {stat("overdueOrders", "opc.k.late", "danger")}
      </div>

      <section class="opc-card" aria-label={t("opc.pipe.title")}>
        <h2 class="opc-h">{t("opc.pipe.title")}</h2>
        {segs.length ? (
          <>
            <div class="opc-bar" role="img" aria-label={segs.map((s) => `${t(`opc.st.${s.status}` as CopyKey)} ${s.count}`).join(", ")}>
              {segs.map((s) => (
                <span key={s.status} class={`opc-bar__seg opc-bar__seg--${s.status}`} style={{ inlineSize: `${s.pct}%` }} />
              ))}
            </div>
            <ul class="opc-legend">
              {segs.map((s) => (
                <li key={s.status}>
                  <span class={`opc-dot opc-bar__seg--${s.status}`} aria-hidden="true" />
                  {t(`opc.st.${s.status}` as CopyKey)} <strong class="num">{formatNumber(s.count)}</strong>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState title={t("opc.pipe.empty")} description={t("opc.pipe.emptyBody")} compact />
        )}
      </section>

      <div class="opc-two">
        <section class="opc-card" aria-label={t("opc.risk.title")}>
          <h2 class="opc-h">{t("opc.risk.title")}</h2>
          {o.atRisk.length ? (
            <ul class="opc-rows">
              {o.atRisk.map((c) => (
                <li key={c.id}>
                  <button type="button" class="opc-row" onClick={() => onOpen(c.id)}>
                    <span class="opc-row__main">
                      <strong>{c.caseNumber}</strong>
                      <span class="opc-muted">{c.customerDisplayName ?? "—"}{c.dueDate ? ` | ${formatDate(c.dueDate)}` : ""}</span>
                      <ReasonChips reasons={c.reasons} hours={c.slaHours} limit={c.slaLimit} />
                    </span>
                    <RiskPill level={c.level} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("opc.risk.empty")} description={t("opc.risk.emptyBody")} compact />
          )}
        </section>

        <section class="opc-card" aria-label={t("opc.team.title")}>
          <h2 class="opc-h">{t("opc.team.title")}</h2>
          {o.team.length ? (
            <ul class="opc-rows">
              {o.team.map((m) => (
                <li key={m.id} class="opc-load">
                  <span>{m.name}</span>
                  <span class="opc-load__bar" aria-hidden="true"><span style={{ inlineSize: `${Math.round((m.activeCases / maxLoad) * 100)}%` }} /></span>
                  <strong class="num">{formatNumber(m.activeCases)}</strong>
                </li>
              ))}
              <li class="opc-load opc-load--muted">
                <span>{t("opc.team.unassigned")}</span>
                <span class="opc-load__bar" aria-hidden="true" />
                <strong class="num">{formatNumber(k.unassigned)}</strong>
              </li>
            </ul>
          ) : (
            <EmptyState title={t("opc.team.empty")} compact />
          )}
        </section>
      </div>
    </div>
  );
}

function CasesPanel({ filters, setFilters, page, setPage, team, onOpen, onIntake, refreshKey }: { filters: Filters; setFilters: (f: Filters) => void; page: number; setPage: (p: number) => void; team: Overview["team"]; onOpen: (id: number) => void; onIntake: () => void; refreshKey?: string }) {
  const list = useQuery(
    (signal) =>
      api.get<CasesPage>("/operations-manager/cases", {
        signal,
        query: { page, pageSize: PAGE_SIZE, status: filters.status, priority: filters.priority, riskLevel: filters.risk, assignedTo: filters.assignee, search: filters.search },
      }),
    [page, filters.status, filters.priority, filters.risk, filters.assignee, filters.search, refreshKey],
  );
  const rows = list.data?.items ?? [];
  const total = list.data?.pagination.total ?? 0;
  const active = [filters.status, filters.priority, filters.risk, filters.assignee].filter(Boolean).length;
  const set = (k: keyof Filters) => (e: Event) => setFilters({ ...filters, [k]: val(e) });
  const nameOf = (id: number | null) => (id ? team.find((m) => m.id === id)?.name ?? "—" : t("opc.f.unassigned"));

  const columns: Column<CaseRow>[] = [
    { key: "no", header: t("opc.col.case"), cell: (r) => <strong>{r.caseNumber}</strong>, mobile: "title" },
    { key: "customer", header: t("opc.f.customer"), cell: (r) => r.customerDisplayName ?? "—" },
    { key: "sale", header: t("opc.f.sale"), cell: (r) => r.salesOrderNumber, mobile: "hide" },
    { key: "status", header: t("opc.col.status"), cell: (r) => <CaseStatusPill status={r.status} /> },
    { key: "priority", header: t("opc.f.priority"), cell: (r) => <PriorityPill priority={r.priority} />, mobile: "hide" },
    { key: "due", header: t("opc.f.due"), cell: (r) => (r.dueDate ? formatDate(r.dueDate) : "—"), mobile: "hide" },
    { key: "owner", header: t("opc.f.assignee"), cell: (r) => nameOf(r.assignedTo), mobile: "hide" },
    { key: "risk", header: t("opc.col.risk"), cell: (r) => <RiskPill level={r.riskLevel} /> },
  ];

  return (
    <>
      <FilterBar search={filters.search} onSearch={(v) => setFilters({ ...filters, search: v })} searchLabel={t("opc.search")} activeCount={active} onClear={() => setFilters({ ...NO_FILTERS, search: filters.search })}>
        <Select aria-label={t("opc.col.status")} value={filters.status} options={[{ value: "", label: t("opc.f.allStatus") }, ...CASE_STATUSES.map((s) => ({ value: s, label: t(`opc.st.${s}` as CopyKey) }))]} onChange={set("status")} />
        <Select aria-label={t("opc.f.priority")} value={filters.priority} options={[{ value: "", label: t("opc.f.allPriority") }, ...PRIORITIES.map((p) => ({ value: p, label: t(`opc.pr.${p}` as CopyKey) }))]} onChange={set("priority")} />
        <Select aria-label={t("opc.col.risk")} value={filters.risk} options={[{ value: "", label: t("opc.f.allRisk") }, { value: "high", label: t("opc.risk.high") }, { value: "medium", label: t("opc.risk.medium") }]} onChange={set("risk")} />
        <Select aria-label={t("opc.f.assignee")} value={filters.assignee} options={[{ value: "", label: t("opc.f.allAssignee") }, ...team.map((m) => ({ value: String(m.id), label: m.name }))]} onChange={set("assignee")} />
      </FilterBar>
      {list.error ? <InlineAlert tone="danger" title={t("opc.err")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>}>{list.error.message}</InlineAlert> : null}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption={t("opc.cases.caption")}
        loading={list.loading}
        onRowClick={(r) => onOpen(r.id)}
        empty={<EmptyState title={t("opc.cases.empty")} description={t(active || filters.search ? "opc.cases.emptyFiltered" : "opc.cases.emptyBody")} compact action={active || filters.search ? undefined : <Button size="sm" icon={Plus} onClick={onIntake}>{t("opc.intake.btn")}</Button>} />}
      />
      {total > PAGE_SIZE ? <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /> : null}
    </>
  );
}

function IntakeDialog({ onClose, onDone }: { onClose: () => void; onDone: (caseId: number) => void }) {
  const act = useAct();
  const [orderNumber, setOrderNumber] = useState("");
  const [priority, setPriority] = useState("normal");
  const submit = async () => {
    const r = await act.run(() => api.post<{ case: { id: number }; idempotentReplay: boolean }>("/operations-manager/cases/from-sales-order-number", { orderNumber: orderNumber.trim(), priority }));
    if (r) {
      onDone(r.case.id);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("opc.intake.title")}
      description={t("opc.intake.desc")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} disabled={!orderNumber.trim()} onClick={() => void submit()}>{t("opc.intake.go")}</Button>
        </>
      }
    >
      <div class="opc-form">
        <Field label={t("opc.intake.number")} required hint={t("opc.intake.hint")}>
          <Input value={orderNumber} onInput={(e) => setOrderNumber(val(e))} dir="ltr" autoFocus />
        </Field>
        <Field label={t("opc.f.priority")}>
          <Select value={priority} options={PRIORITIES.map((p) => ({ value: p, label: t(`opc.pr.${p}` as CopyKey) }))} onChange={(e) => setPriority(val(e))} />
        </Field>
        <Button variant="ghost" size="sm" onClick={() => { onClose(); navigate("/staff/sales"); }}>{t("opc.intake.browse")}</Button>
      </div>
    </Dialog>
  );
}
