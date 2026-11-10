import "../copy/operations";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t } from "../copy";
import { Button, EmptyState, InlineAlert, Skeleton, Stat } from "../design/components";
import { RefreshCw } from "../design/icons";
import { formatDate } from "../lib/format";
import { loadBand, orderState, pct, sortOrders, type Capacity, type CenterCapacity } from "./capacityCore";

/** السعة: حمل المصنع على 14 يوم عمل جاية بسقف تحميل 85%. */
export function OperationsCapacity() {
  const q = useQuery((signal) => api.get<Capacity>("/operations-center/capacity", { signal }), []);
  const c = q.data;
  if (q.error) return <InlineAlert tone="danger" title={t("opc.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert>;
  if (q.loading || !c) return <Skeleton lines={5} />;
  return (
    <div class="opc-stack">
      <div class="opc-toolbar">
        <p class="opc-muted">{t("opc.cap.note", { cap: String(pct(c.cap)) })}</p>
        <Button variant="secondary" icon={RefreshCw} loading={q.loading} onClick={() => void q.refetch()}>{t("opc.refresh")}</Button>
      </div>
      {c.linesAssumed ? <InlineAlert tone="warn">{t("opc.cap.assumed")}</InlineAlert> : null}
      {c.noRecipeOrders > 0 ? <InlineAlert tone="info">{t("opc.cap.norecipe", { n: String(c.noRecipeOrders) })}</InlineAlert> : null}
      <div class="opc-stats">
        <Stat label={t("opc.cap.util")} value={`${pct(c.utilization)}%`} tone={c.utilization >= c.cap ? "danger" : c.utilization >= 0.6 ? "warn" : "success"} />
        <Stat label={t("opc.cap.lines")} value={String(c.lines)} />
        <Stat label={t("opc.cap.open")} value={String(c.openOrders)} />
        <Stat label={t("opc.cap.queue")} value={String(c.queueDays)} />
        <Stat label={t("opc.cap.full")} value={String(c.overloadedDays)} tone={c.overloadedDays ? "danger" : "success"} />
        <Stat label={t("opc.cap.late")} value={String(c.lateOrders)} tone={c.lateOrders ? "danger" : "success"} />
      </div>
      {c.days.length === 0 ? <EmptyState title={t("opc.cap.empty")} compact /> : (
        <ol class="opc-cap" aria-label={t("opc.cap.title")}>
          {c.days.map((d) => (
            <li key={d.date} class={`opc-cap__day opc-cap__day--${loadBand(d.load)}`}>
              <span class="opc-cap__bar" style={{ blockSize: `${Math.min(100, Math.max(4, pct(d.load)))}%` }} role="img" aria-label={t("opc.cap.dayAria", { d: formatDate(d.date), p: String(pct(d.load)) })} />
              <span class="opc-cap__pct">{pct(d.load)}%</span>
              <span class="opc-cap__date">{formatDate(d.date)}</span>
            </li>
          ))}
        </ol>
      )}
      <CenterHeatmap />
    </div>
  );
}

/** الخريطة الحرارية بدقايق مسارات التصنيع على مراكز العمل، وتاريخ الانتهاء المتوقع للأوامر. */
function CenterHeatmap() {
  const q = useQuery((signal) => api.get<CenterCapacity>("/operations-center/capacity/centers", { signal }), []);
  const c = q.data;
  if (q.error) return <InlineAlert tone="danger" title={t("opc.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert>;
  if (q.loading || !c) return <Skeleton lines={4} />;
  const orders = sortOrders(c.orders);
  return (
    <section class="opc-heat" aria-label={t("opc.heat.title")}>
      <h3 class="opc-heat__title">{t("opc.heat.title")}</h3>
      <p class="opc-muted">{t("opc.heat.note", { cap: String(pct(c.cap)) })}</p>
      {c.shiftsAssumed ? <InlineAlert tone="warn">{t("opc.heat.noShifts")}</InlineAlert> : null}
      {c.liveRoutingOrders > 0 ? <InlineAlert tone="info">{t("opc.heat.live", { n: String(c.liveRoutingOrders) })}</InlineAlert> : null}
      {c.noRoutingOrders > 0 ? <InlineAlert tone="info">{t("opc.heat.noRouting", { n: String(c.noRoutingOrders) })}</InlineAlert> : null}
      {c.unassignedOps > 0 ? <InlineAlert tone="info">{t("opc.heat.unassigned", { n: String(c.unassignedOps) })}</InlineAlert> : null}
      {c.centers.length === 0 || c.scheduledOrders === 0 ? <EmptyState title={t("opc.heat.empty")} compact /> : (
        <>
          <div class="opc-heat__scroll">
            <table class="opc-heat__table">
              <thead>
                <tr>
                  <th scope="col">{t("opc.heat.center")}</th>
                  {(c.centers[0]?.days ?? []).map((d) => <th key={d.date} scope="col">{formatDate(d.date)}</th>)}
                </tr>
              </thead>
              <tbody>
                {c.centers.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{row.name}</th>
                    {row.days.map((d) => (
                      <td key={d.date} class={`opc-heat__cell opc-heat__cell--${loadBand(d.load)}`} aria-label={t("opc.heat.cellAria", { c: row.name, d: formatDate(d.date), p: String(pct(d.load)) })}>{pct(d.load)}%</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 class="opc-heat__title">{t("opc.heat.ordersTitle")}</h3>
          <div class="opc-heat__scroll">
            <table class="opc-heat__table">
              <thead>
                <tr>
                  <th scope="col">{t("opc.heat.order")}</th>
                  <th scope="col">{t("opc.heat.product")}</th>
                  <th scope="col">{t("opc.heat.needed")}</th>
                  <th scope="col">{t("opc.heat.finish")}</th>
                  <th scope="col">{t("opc.heat.status")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const st = orderState(o);
                  return (
                    <tr key={o.id}>
                      <th scope="row">{o.orderNumber}</th>
                      <td>{o.productName}</td>
                      <td>{o.neededBy ? formatDate(o.neededBy) : t("opc.heat.noDate")}</td>
                      <td>{o.finish ? formatDate(o.finish) : t("opc.heat.beyond")}</td>
                      <td class={st === "late" ? "opc-heat__late" : undefined}>{st === "late" ? (o.lateDays !== null ? t("opc.heat.lateBy", { n: String(o.lateDays) }) : t("opc.heat.lateFar")) : st === "onTime" ? t("opc.heat.onTime") : t("opc.heat.noDate")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
