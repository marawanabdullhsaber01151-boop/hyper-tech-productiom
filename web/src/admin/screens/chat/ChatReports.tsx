import { useState } from "preact/hooks";
import { t } from "../../../copy";
import { DataTable, EmptyState, InlineAlert, Button, ProgressBar, Select, Skeleton, Stat, type Column } from "../../../design/components";
import { useQuery } from "../../../api/hooks";
import { formatNumber } from "../../../lib/format";
import { api } from "../../api";

interface Agg {
  avg_minutes: string | number | null;
  median_minutes: string | number | null;
}
interface Report {
  days: number;
  totals: {
    open_conversations: number;
    closed_conversations: number;
    escalations: number;
    customer_messages: number;
    staff_messages: number;
    avg_stars: string | number | null;
    ratings_count: number;
  };
  ratingDistribution: Array<{ stars: number | string; n: number }>;
  responseTime: { overall: Agg | null; perAgent: Array<Agg & { name: string; answered: number }> };
}

/** دقايق → «12 د» أو «1.5 س». */
export function formatMinutes(m: string | number | null | undefined): string {
  if (m === null || m === undefined || m === "") return "—";
  const n = Number(m);
  if (!Number.isFinite(n)) return "—";
  if (n < 60) return t("c.r.min", { n: n.toFixed(n < 10 ? 1 : 0) });
  return t("c.r.hour", { n: (n / 60).toFixed(1) });
}

const RANGES = [7, 30, 90, 365] as const;

export function ChatReports() {
  const [days, setDays] = useState<number>(30);
  const q = useQuery((signal) => api.get<Report>("/chat/reports", { query: { days }, signal }), [days]);
  const r = q.data;

  const agents = r?.responseTime.perAgent ?? [];
  const cols: Column<(typeof agents)[number]>[] = [
    { key: "name", header: t("c.r.col.name"), cell: (a) => a.name, mobile: "title" },
    { key: "answered", header: t("c.r.col.answered"), cell: (a) => formatNumber(a.answered), numeric: true },
    { key: "median", header: t("c.r.col.median"), cell: (a) => formatMinutes(a.median_minutes), numeric: true },
    { key: "avg", header: t("c.r.col.avg"), cell: (a) => formatMinutes(a.avg_minutes), numeric: true },
  ];

  const dist = [5, 4, 3, 2, 1].map((s) => ({ s, n: Number(r?.ratingDistribution.find((d) => Number(d.stars) === s)?.n ?? 0) }));
  const maxN = Math.max(1, ...dist.map((d) => d.n));
  const stars = r?.totals.avg_stars;

  return (
    <div class="ad-stack">
      <div class="ad-row ad-row--between">
        <h2 class="cc-h2">{t("c.r.title")}</h2>
        <label class="cc-range">
          <span class="ad-muted">{t("c.r.range")}</span>
          <Select
            aria-label={t("c.r.range")}
            value={String(days)}
            options={RANGES.map((d) => ({ value: String(d), label: t(`c.r.d${d}` as "c.r.d7") }))}
            onChange={(e) => setDays(Number((e.currentTarget as HTMLSelectElement).value))}
          />
        </label>
      </div>

      {q.error ? <InlineAlert tone="danger" title={t("c.r.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert> : null}
      {q.loading && !r ? <Skeleton height={120} /> : null}

      {r ? (
        <>
          <div class="cc-kpis">
            <Stat label={t("c.r.open")} value={formatNumber(r.totals.open_conversations)} tone="brand" />
            <Stat label={t("c.r.closed")} value={formatNumber(r.totals.closed_conversations)} />
            <Stat label={t("c.r.custMsgs")} value={formatNumber(r.totals.customer_messages)} />
            <Stat label={t("c.r.staffMsgs")} value={formatNumber(r.totals.staff_messages)} tone="success" />
            <Stat label={t("c.r.median")} value={formatMinutes(r.responseTime.overall?.median_minutes)} tone="info" />
            <Stat label={t("c.r.avg")} value={formatMinutes(r.responseTime.overall?.avg_minutes)} />
            <Stat label={t("c.r.esc")} value={formatNumber(r.totals.escalations)} tone={r.totals.escalations > 0 ? "warn" : "neutral"} />
            <Stat label={t("c.r.stars")} value={stars === null || stars === undefined ? "—" : Number(stars).toFixed(1)} hint={t("c.r.stars.hint", { n: r.totals.ratings_count })} tone="success" />
          </div>

          <section class="cc-card" aria-labelledby="cc-dist">
            <h3 id="cc-dist" class="cc-h3">{t("c.r.dist")}</h3>
            <ul class="cc-dist">
              {dist.map((d) => (
                <li key={d.s}>
                  <span class="cc-dist__label">{t("c.r.dist.row", { n: d.s })}</span>
                  <ProgressBar value={d.n} max={maxN} label={t("c.r.dist.row", { n: d.s })} tone="warn" />
                  <span class="num cc-dist__n">{formatNumber(d.n)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section class="cc-card" aria-labelledby="cc-agents">
            <h3 id="cc-agents" class="cc-h3">{t("c.r.agents")}</h3>
            <DataTable caption={t("c.r.agents.caption")} columns={cols} rows={agents} rowKey={(a) => a.name} empty={<EmptyState compact title={t("c.r.none")} />} />
          </section>
          <p class="ad-muted">{t("c.r.note")}</p>
        </>
      ) : null}
    </div>
  );
}
