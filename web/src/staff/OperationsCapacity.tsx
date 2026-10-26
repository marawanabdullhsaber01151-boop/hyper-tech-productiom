import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t } from "../copy";
import { Button, EmptyState, InlineAlert, Skeleton, Stat } from "../design/components";
import { RefreshCw } from "../design/icons";
import { formatDate } from "../lib/format";
import { loadBand, pct, type Capacity } from "./capacityCore";

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
    </div>
  );
}
