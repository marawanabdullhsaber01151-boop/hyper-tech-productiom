import { useEffect, useMemo, useState } from "preact/hooks";
import { Link } from "../app/router";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, EmptyState, Icon, InlineAlert, Spinner, Stat, StatusPill } from "../design/components";
import { CircleAlert, CircleCheck, Clock, TriangleAlert } from "../design/icons";
import { formatNumber, formatRelative } from "../lib/format";
import { resolveHref } from "./nav";

import { HEALTH_ROLES } from "./staffRoles";

export { HEALTH_ROLES };

export type HealthStatus = "ok" | "warn" | "bad" | "unknown";
export interface HealthCheck {
  id: string;
  group: string;
  title: string;
  status: HealthStatus;
  message: string;
  action?: string;
  count?: number;
  examples?: string[];
  href?: string;
}
export interface HealthGroup {
  id: string;
  title: string;
  status: HealthStatus;
  checks: HealthCheck[];
}
export interface HealthReport {
  status: HealthStatus;
  headline: string;
  checkedAt: string;
  summary: Record<HealthStatus, number>;
  groups: HealthGroup[];
}

const AUTO_REFRESH_MS = 5 * 60 * 1000;
const TONE = { ok: "success", warn: "warn", bad: "danger", unknown: "warn" } as const;
const ALERT_TONE = { ok: "success", warn: "warn", bad: "danger", unknown: "warn" } as const;
const ICON = { ok: CircleCheck, warn: TriangleAlert, bad: CircleAlert, unknown: Clock } as const;

/** بيفلتر المجموعات لو المستخدم عايز المشاكل بس. المجموعة اللي كلها سليمة بتختفي. */
export function visibleGroups(groups: HealthGroup[], onlyProblems: boolean): HealthGroup[] {
  if (!onlyProblems) return groups;
  return groups
    .map((g) => ({ ...g, checks: g.checks.filter((c) => c.status !== "ok") }))
    .filter((g) => g.checks.length > 0);
}

function Action({ href }: { href: string }) {
  const r = resolveHref(href);
  return r.kind === "spa" ? (
    <Link to={r.to} class="ht-btn ht-btn--secondary ht-btn--sm">{t("staff.health.open")}</Link>
  ) : (
    <a href={r.href} class="ht-btn ht-btn--secondary ht-btn--sm">{t("staff.health.open")}</a>
  );
}

function CheckCard({ c }: { c: HealthCheck }) {
  return (
    <li class={`sh-check sh-check--${c.status}`} data-status={c.status}>
      <span class="sh-check__icon"><Icon icon={ICON[c.status]} size={24} /></span>
      <div class="sh-check__body">
        <div class="sh-check__head">
          <h3 class="sh-check__title">{c.title}</h3>
          <StatusPill tone={TONE[c.status]}>{t(`staff.health.status.${c.status}` as CopyKey)}</StatusPill>
        </div>
        <p class="sh-check__msg">{c.message}</p>
        {c.action ? (
          <p class="sh-check__act"><strong>{t("staff.health.action")}</strong> {c.action}</p>
        ) : null}
        {c.examples && c.examples.length ? (
          <details class="sh-check__more">
            <summary>{t("staff.health.details")}</summary>
            <ul>{c.examples.map((e) => <li key={e}>{e}</li>)}</ul>
          </details>
        ) : null}
        {c.href && c.status !== "ok" ? <div class="sh-check__go"><Action href={c.href} /></div> : null}
      </div>
    </li>
  );
}

/** صحة النظام: فحوصات حقيقية بشرح بسيط وإيه المطلوب. بتتحدّث لوحدها وبتوقف لما التاب يتخبّى. */
export function SystemHealth() {
  const q = useQuery((signal) => api.get<HealthReport>("/admin/system-health", { signal }), []);
  const [onlyProblems, setOnlyProblems] = useState<boolean | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void q.refetch();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const report = q.data;
  const hasProblems = !!report && report.summary.bad + report.summary.warn + report.summary.unknown > 0;
  // أول مرة: لو في مشاكل نعرضها لوحدها، ولو مفيش نعرض الكل. بعدها الاختيار للمستخدم.
  const only = onlyProblems ?? hasProblems;
  const groups = useMemo(() => (report ? visibleGroups(report.groups, only) : []), [report, only]);

  return (
    <div class="ad-page sh-page">
      <div class="sh-top">
        <div>
          <h1 class="ad-title">{t("staff.health.title")}</h1>
          <p class="st-login__sub">{t("staff.health.subtitle")}</p>
        </div>
        <Button variant="primary" loading={q.loading} onClick={() => void q.refetch()}>
          {q.loading ? t("staff.health.checking") : t("staff.health.recheck")}
        </Button>
      </div>

      {q.error ? (
        <InlineAlert tone="danger" title={t("staff.health.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("staff.health.retry")}</Button>}>
          {q.error.message}
        </InlineAlert>
      ) : null}

      {!report && q.loading ? <div class="sh-loading"><Spinner /> <span>{t("staff.health.loading")}</span></div> : null}

      {report ? (
        <>
          <InlineAlert tone={ALERT_TONE[report.status]} title={report.headline}>
            {t("staff.health.checkedAt", { time: formatRelative(report.checkedAt) })} · {t("staff.health.auto")}
          </InlineAlert>

          <div class="st-stats">
            <Stat label={t("staff.health.stat.ok")} value={formatNumber(report.summary.ok)} tone="success" />
            <Stat label={t("staff.health.stat.warn")} value={formatNumber(report.summary.warn)} tone={report.summary.warn ? "warn" : "neutral"} />
            <Stat label={t("staff.health.stat.bad")} value={formatNumber(report.summary.bad)} tone={report.summary.bad ? "danger" : "neutral"} />
            <Stat label={t("staff.health.stat.unknown")} value={formatNumber(report.summary.unknown)} tone={report.summary.unknown ? "warn" : "neutral"} />
          </div>

          <div class="sh-toggle">
            <Button size="sm" variant={only ? "primary" : "secondary"} aria-pressed={only} onClick={() => setOnlyProblems(true)}>{t("staff.health.only")}</Button>
            <Button size="sm" variant={only ? "secondary" : "primary"} aria-pressed={!only} onClick={() => setOnlyProblems(false)}>{t("staff.health.all")}</Button>
          </div>

          {groups.length === 0 ? <EmptyState title={t("staff.health.allgood")} compact /> : null}

          {groups.map((g) => {
            const full = report.groups.find((x) => x.id === g.id) ?? g;
            const okCount = full.checks.filter((c) => c.status === "ok").length;
            return (
              <section key={g.id} class="sh-group" aria-labelledby={`sh-g-${g.id}`}>
                <div class="sh-group__head">
                  <h2 id={`sh-g-${g.id}`} class="sh-group__title">{g.title}</h2>
                  <StatusPill tone={TONE[full.status]}>{t("staff.health.group", { ok: okCount, total: full.checks.length })}</StatusPill>
                </div>
                <ul class="sh-list">{g.checks.map((c) => <CheckCard key={c.id} c={c} />)}</ul>
              </section>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
