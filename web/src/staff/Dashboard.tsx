import { useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Card, DataTable, EmptyState, InlineAlert, ProgressBar, Stat, StatusPill, type Column } from "../design/components";
import { RefreshCw } from "../design/icons";
import { formatDate, formatNumber } from "../lib/format";
import { resolveHref, type NavResponse } from "./nav";
import { getShared, invalidateShared } from "./sharedData";
import { Link } from "../app/router";
import { categoryShares, computeKpis, deriveAlerts, isActive, isKnownStatus, statusCounts, statusTone, type DashAlert, type DashSummary, type InvItem, type WorkflowOrder } from "./dashboardCore";

const MAX_ALERTS = 8;
const REFRESH_MS = 60_000;

const statusText = (s: string) => (isKnownStatus(s) ? t(`staff.dash.st.${s}` as CopyKey) : s);
const today = () => new Date().toISOString().slice(0, 10);

function alertText(a: DashAlert): { title: string; body: string } {
  switch (a.kind) {
    case "out":
      return { title: t("staff.dash.alert.out", { subject: a.subject }), body: t("staff.dash.alert.qty", { qty: formatNumber(a.qty ?? 0), unit: a.detail, min: formatNumber(a.min ?? 0) }) };
    case "low":
      return { title: t("staff.dash.alert.low", { subject: a.subject }), body: t("staff.dash.alert.qty", { qty: formatNumber(a.qty ?? 0), unit: a.detail, min: formatNumber(a.min ?? 0) }) };
    case "rejected":
      return { title: t("staff.dash.alert.rejected", { subject: a.subject }), body: t("staff.dash.alert.rejectedBody", { product: a.detail }) };
    case "late":
      return { title: t("staff.dash.alert.late", { subject: a.subject }), body: t("staff.dash.alert.lateBody", { product: a.detail, due: formatDate(a.due ?? "") }) };
    case "waiting":
      return { title: t("staff.dash.alert.waiting", { subject: a.subject }), body: t("staff.dash.alert.waitingBody", { product: a.detail }) };
    default:
      return { title: t("staff.dash.alert.near", { subject: a.subject }), body: "" };
  }
}

/** كل روابط الصفحات المتاحة للمستخدم (من /nav): الروابط السريعة بتظهر بس لو الصفحة فعلًا متاحة له. */
function pageHrefs(nav: NavResponse | undefined): Set<string> {
  const out = new Set<string>();
  for (const d of nav?.departments ?? []) for (const s of d.subFunctions) for (const p of s.pages) out.add(p.href.replace(/^\//, ""));
  return out;
}

const QUICK: Array<{ href: string; label: CopyKey }> = [
  { href: "/v2/staff/production?tab=orders", label: "staff.dash.quick.production" },
  { href: "/v2/staff/stock", label: "staff.dash.quick.inventory" },
  { href: "/v2/staff/sales", label: "staff.dash.quick.sales" },
  { href: "/v2/staff/system-health", label: "staff.dash.quick.health" },
];

/**
 * لوحة التشغيل في الرئيسية. كل مصدر بيتحمّل لو الدور مسموح له (GET /me/access)، فالدور اللي مالوش مصدر
 * مايشوفش «تعذّر تحميل». لو الدور مالوش ولا مصدر اللوحة كلها بتختفي. بتتحدّث كل دقيقة.
 */
export function Dashboard({ nav }: { nav?: NavResponse }) {
  const access = useQuery((signal) => api.get<{ can: Record<string, boolean> }>("/me/access", { signal }), []);
  // لو فحص الصلاحيات نفسه وقع، بنجرّب (السيرفر هو اللي بيحمي فعلًا) زي اللوحة القديمة
  const may = (k: string) => !access.loading && (!access.data || access.data.can[k] === true);
  const mayOrders = may("productionWorkflowRead");
  const mayStock = may("inventoryRead");
  const maySummary = may("dashboardRead");

  const orders = useQuery(() => (mayOrders ? getShared<WorkflowOrder[]>("/production-workflow") : Promise.resolve(null)), [mayOrders]);
  const stock = useQuery(() => (mayStock ? getShared<InvItem[]>("/inventory") : Promise.resolve(null)), [mayStock]);
  const summary = useQuery((signal) => (maySummary ? api.get<DashSummary>("/dashboard", { signal }) : Promise.resolve(null)), [maySummary]);
  const [updated, setUpdated] = useState<Date | null>(null);

  const refreshAll = async () => {
    // التحديث اليدوي والدوري دايمًا بيجيب بيانات جديدة (الكاش المشترك للجرس والبحث بس)
    invalidateShared("/production-workflow");
    invalidateShared("/inventory");
    await Promise.all([mayOrders ? orders.refetch() : null, mayStock ? stock.refetch() : null, maySummary ? summary.refetch() : null]);
    setUpdated(new Date());
  };
  useEffect(() => {
    if (access.loading) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refreshAll();
    }, REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.loading, mayOrders, mayStock, maySummary]);
  useEffect(() => {
    if (!orders.loading && !stock.loading && !summary.loading) setUpdated(new Date());
  }, [orders.loading, stock.loading, summary.loading]);

  // الراوت بيرجّع { data, stats } والعميل بيفك الغلاف، فالنتيجة هي المصفوفة نفسها
  const orderRows = orders.data ?? [];
  const items = stock.data ?? [];
  const alerts = useMemo(() => deriveAlerts(orderRows, items, summary.data ?? null, today()), [orderRows, items, summary.data]);
  const kpis = useMemo(() => computeKpis(orderRows, items), [orderRows, items]);
  const hrefs = useMemo(() => pageHrefs(nav), [nav]);

  if (access.loading) return null;
  if (!mayOrders && !mayStock && !maySummary) return null;

  const failed = [
    mayOrders && orders.error ? t("staff.dash.part.orders") : null,
    mayStock && stock.error ? t("staff.dash.part.stock") : null,
    maySummary && summary.error ? t("staff.dash.part.summary") : null,
  ].filter(Boolean) as string[];

  const active = orderRows.filter(isActive);
  const columns: Column<WorkflowOrder>[] = [
    { key: "code", header: t("staff.dash.orders.code"), cell: (o) => o.orderNumber, mobile: "title" },
    { key: "product", header: t("staff.dash.orders.product"), cell: (o) => o.productName },
    { key: "qty", header: t("staff.dash.orders.qty"), cell: (o) => (o.qty === null || !Number.isFinite(Number(o.qty)) ? "—" : formatNumber(Number(o.qty))), numeric: true },
    { key: "status", header: t("staff.dash.orders.status"), cell: (o) => <StatusPill tone={statusTone(o.workflowStatus)}>{statusText(o.workflowStatus)}</StatusPill> },
    { key: "due", header: t("staff.dash.orders.due"), cell: (o) => (o.neededBy ? formatDate(o.neededBy) : "—"), mobile: "hide" },
  ];
  const counts = statusCounts(orderRows);
  const maxCount = Math.max(1, ...counts.map((c) => c.count));
  const shares = categoryShares(items);
  const pass = summary.data?.quality?.passRate;
  const dir = summary.data?.quality?.trend?.direction ?? "stable";
  const near = summary.data?.inventory?.approachingLowStock ?? [];
  const quick = QUICK.filter((q) => hrefs.has(q.href.replace(/^\//, "")));

  return (
    <section class="st-dash" aria-labelledby="st-dash-title">
      <div class="st-dash__head">
        <h2 id="st-dash-title" class="st-dash__title">{t("staff.dash.title")}</h2>
        <div class="st-dash__tools">
          <StatusPill tone={failed.length ? "danger" : "success"} pulse={!failed.length}>{failed.length ? t("staff.dash.offline") : t("staff.dash.live")}</StatusPill>
          {updated ? <span class="st-dash__muted">{t("staff.dash.updated", { time: updated.toLocaleTimeString("ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" }) })}</span> : null}
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void refreshAll()}>{t("staff.dash.refresh")}</Button>
        </div>
      </div>

      {failed.length ? <InlineAlert tone="danger">{t("staff.dash.err", { parts: failed.join(t("staff.dash.sep")) })}</InlineAlert> : null}

      {mayOrders || mayStock ? (
        <div class="st-stats">
          {mayOrders ? <Stat label={t("staff.dash.stat.completed")} value={formatNumber(kpis.completedThisMonth)} tone="success" /> : null}
          {mayOrders ? <Stat label={t("staff.dash.stat.active")} value={formatNumber(kpis.active)} tone="info" /> : null}
          {mayStock ? <Stat label={t("staff.dash.stat.low")} value={formatNumber(kpis.lowStock)} tone={kpis.lowStock ? "warn" : "neutral"} /> : null}
          {mayStock ? <Stat label={t("staff.dash.stat.coverage")} value={`${formatNumber(kpis.coverage)}%`} hint={t("staff.dash.stat.coverageHint")} /> : null}
        </div>
      ) : null}

      <div class="st-dash__cols">
        {mayOrders ? (
          <Card class="st-dash__card">
            <h3 class="st-dash__h3">{t("staff.dash.status.title")}</h3>
            {orderRows.length === 0 && !orders.loading ? (
              <EmptyState title={t("staff.dash.status.empty")} compact />
            ) : (
              <ul class="st-dash__bars">
                {counts.map((c) => (
                  <li key={c.status}>
                    <div class="st-dash__row"><span>{t(`staff.dash.st.${c.status}` as CopyKey)}</span><strong class="num">{formatNumber(c.count)}</strong></div>
                    <ProgressBar value={c.count} max={maxCount} label={t(`staff.dash.st.${c.status}` as CopyKey)} tone={statusTone(c.status) === "neutral" ? "brand" : (statusTone(c.status) as "info")} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {mayOrders || mayStock ? (
          <Card class="st-dash__card">
            <div class="st-dash__row">
              <h3 class="st-dash__h3">{t("staff.dash.alerts.title")}</h3>
              <StatusPill tone={alerts.some((a) => a.tone === "danger") ? "danger" : alerts.length ? "warn" : "success"}>{t("staff.dash.alerts.count", { n: alerts.length })}</StatusPill>
            </div>
            {alerts.length === 0 ? (
              <EmptyState title={t("staff.dash.alerts.empty")} compact />
            ) : (
              <ul class="st-dash__alerts">
                {alerts.slice(0, MAX_ALERTS).map((a) => {
                  const x = alertText(a);
                  return (
                    <li key={a.id} class={`st-dash__alert st-dash__alert--${a.tone}`}>
                      <strong>{x.title}</strong>
                      {x.body ? <span class="st-dash__muted">{x.body}</span> : null}
                    </li>
                  );
                })}
                {alerts.length > MAX_ALERTS ? <li class="st-dash__muted">{t("staff.dash.alerts.more", { n: alerts.length - MAX_ALERTS })}</li> : null}
              </ul>
            )}
          </Card>
        ) : null}
      </div>

      {mayOrders ? (
        <Card class="st-dash__card">
          <div class="st-dash__row">
            <h3 class="st-dash__h3">{t("staff.dash.orders.title")}</h3>
            {hrefs.has("v2/staff/production?tab=orders") ? <a class="st-dash__link" href="/v2/staff/production?tab=orders">{t("staff.dash.viewAll")}</a> : null}
          </div>
          <DataTable
            columns={columns}
            rows={active.slice(0, 8)}
            rowKey={(o) => o.id}
            caption={t("staff.dash.orders.caption")}
            loading={orders.loading}
            empty={<EmptyState title={t("staff.dash.orders.empty")} compact />}
          />
        </Card>
      ) : null}

      <div class="st-dash__cols">
        {mayStock ? (
          <Card class="st-dash__card">
            <h3 class="st-dash__h3">{t("staff.dash.cat.title")}</h3>
            {items.length === 0 && !stock.loading ? (
              <EmptyState title={t("staff.dash.cat.empty")} compact />
            ) : (
              <ul class="st-dash__bars">
                {shares.map((s) => (
                  <li key={s.category}>
                    <div class="st-dash__row">
                      <span>{t(`staff.dash.cat.${s.category}` as CopyKey)}</span>
                      <span class="st-dash__muted num">{t("staff.dash.cat.items", { n: formatNumber(s.count), total: formatNumber(items.length) })} ({s.pct}%)</span>
                    </div>
                    <ProgressBar value={s.pct} label={t(`staff.dash.cat.${s.category}` as CopyKey)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {maySummary && summary.data ? (
          <Card class="st-dash__card">
            <h3 class="st-dash__h3">{t("staff.dash.sum.title")}</h3>
            <div class="st-stats">
              <Stat
                label={t("staff.dash.sum.pass")}
                value={pass === undefined ? "—" : `${formatNumber(pass)}%`}
                hint={t(`staff.dash.sum.${dir === "up" || dir === "down" ? dir : "stable"}` as CopyKey)}
                tone={dir === "down" ? "warn" : dir === "up" ? "success" : "neutral"}
              />
              <Stat label={t("staff.dash.sum.sales")} value={formatNumber(summary.data.sales?.trend?.last7DaysOrders ?? 0)} />
            </div>
            <h4 class="st-dash__h4">{t("staff.dash.sum.near")}</h4>
            {near.length === 0 ? (
              <p class="st-dash__muted">{t("staff.dash.sum.nearNone")}</p>
            ) : (
              <ul class="st-dash__alerts">
                {near.map((n) => (
                  <li key={n.id} class="st-dash__row">
                    <span>{n.name}</span>
                    <span class="st-dash__muted num">{n.proximityRatio == null ? "—" : t("staff.dash.sum.nearRatio", { pct: Math.round(n.proximityRatio * 100) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>

      {quick.length ? (
        <nav class="st-dash__quick" aria-label={t("staff.dash.quick.title")}>
          {quick.map((q) => {
            const r = resolveHref(q.href);
            return r.kind === "spa" ? (
              <Link key={q.href} to={r.to} class="st-dash__chip">{t(q.label)}</Link>
            ) : (
              <a key={q.href} href={r.href} class="st-dash__chip">{t(q.label)}</a>
            );
          })}
        </nav>
      ) : null}
    </section>
  );
}
