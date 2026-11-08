import "../copy/reports";
import { useEffect, useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api, downloadCsv } from "../admin/api";
import { t, type CopyKey } from "../copy";
import { Button, EmptyState, Field, InlineAlert, Input, Select, Skeleton } from "../design/components";
import { formatDateTime } from "../lib/format";
import { defaultRange, displayCell, exportFileName, isNumericKind, rangeProblem, reportQuery, STATUS_FILTERS, type ExportFormat, type ReportId, type ReportMeta, type ReportResult } from "./reportsCore";
import "./Reports.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;

/** التقارير: مبيعات ومخزون ومشتريات. معاينة، تنزيل Excel/CSV، وطباعة PDF من المتصفح. */
export function Reports() {
  const [metas, setMetas] = useState<ReportMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [id, setId] = useState<ReportId | "">("");
  const [{ from, to }, setRange] = useState(() => defaultRange());
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [asOf, setAsOf] = useState<string>("");
  const act = useAct();

  useEffect(() => {
    const ctrl = new AbortController();
    api.get<ReportMeta[]>("/reports", { signal: ctrl.signal }).then((list) => {
      const rows = Array.isArray(list) ? list : [];
      setMetas(rows);
      if (rows[0]) setId(rows[0].id);
    }).catch(() => { if (!ctrl.signal.aborted) setFailed(true); });
    return () => ctrl.abort();
  }, []);

  const meta = metas?.find((m) => m.id === id) ?? null;
  const problem = meta?.needsRange ? rangeProblem(from, to) : null;

  const pick = (next: string) => { setId(next as ReportId); setStatus(""); setResult(null); };
  const run = async () => {
    if (!meta || problem) return;
    const r = await act.run(() => api.get<ReportResult>(`/reports/${meta.id}`, { query: reportQuery(meta, from, to, status) }));
    if (r) { setResult(r); setAsOf(formatDateTime(new Date())); }
  };
  const download = async (format: ExportFormat) => {
    if (!meta || problem) return;
    const ok = await downloadCsv(`/reports/${meta.id}`, reportQuery(meta, from, to, status, format), exportFileName(meta.id, meta, from, to, format));
    await act.run(async () => { if (!ok) throw new Error(t("rep.exportFail")); return true; }, t("rep.exported"));
  };

  if (failed) return <div class="ad-page"><InlineAlert tone="warn">{t("rep.loadFail")}</InlineAlert></div>;
  if (!metas) return <div class="ad-page"><Skeleton height={120} /></div>;
  if (!metas.length) return <div class="ad-page"><EmptyState title={t("rep.none")} /></div>;
  const statuses = id ? STATUS_FILTERS[id] : [];
  return (
    <div class="ad-page rp-page">
      <div class="rp-noprint">
        <h1 class="ad-title">{t("rep.title")}</h1>
        <p class="st-login__sub">{t("rep.subtitle")}</p>
        <div class="act-toolbar">
          <Field label={t("rep.pick")}><Select value={id} options={metas.map((m) => ({ value: m.id, label: m.title }))} onChange={(e) => pick(val(e))} /></Field>
          {meta?.needsRange ? (
            <>
              <Field label={t("rep.from")}><Input type="date" value={from} onInput={(e) => setRange({ from: val(e), to })} /></Field>
              <Field label={t("rep.to")}><Input type="date" value={to} onInput={(e) => setRange({ from, to: val(e) })} /></Field>
            </>
          ) : null}
          {statuses.length ? (
            <Field label={t("rep.status")}><Select value={status} options={[{ value: "", label: t("rep.status.all") }, ...statuses.map((s) => ({ value: s, label: t(`rep.status.${s}` as CopyKey) }))]} onChange={(e) => setStatus(val(e))} /></Field>
          ) : null}
        </div>
        {meta && !meta.needsRange ? <p class="act-muted">{t("rep.snapshot")}</p> : null}
        {problem ? <InlineAlert tone="warn">{t(`rep.err.${problem}` as CopyKey)}</InlineAlert> : null}
        <div class="act-toolbar">
          <Button loading={act.busy} disabled={!!problem} onClick={() => void run()}>{t("rep.run")}</Button>
          <Button variant="ghost" disabled={!!problem || act.busy} onClick={() => void download("xlsx")}>{t("rep.excel")}</Button>
          <Button variant="ghost" disabled={!!problem || act.busy} onClick={() => void download("csv")}>{t("rep.csv")}</Button>
          <Button variant="ghost" disabled={!result} onClick={() => window.print()}>{t("rep.print")}</Button>
        </div>
        {result ? <p class="act-muted">{t("rep.printHint")}</p> : null}
      </div>
      {result ? <ReportView result={result} meta={meta} from={from} to={to} asOf={asOf} /> : null}
    </div>
  );
}

function ReportView({ result, meta, from, to, asOf }: { result: ReportResult; meta: ReportMeta | null; from: string; to: string; asOf: string }) {
  return (
    <section class="rp-print" aria-labelledby="rp-h">
      <h2 id="rp-h" class="rp-h">{result.title}</h2>
      <p class="act-muted">{meta?.needsRange ? t("rep.period", { from, to }) : t("rep.snapshot")} · {t("rep.generated", { when: asOf })}</p>
      {result.truncated ? <InlineAlert tone="warn">{t("rep.truncated")}</InlineAlert> : null}
      {result.rows.length ? (
        <div class="rp-scroll">
          <table class="rp-table">
            <caption class="rp-cap">{t("rep.caption")}</caption>
            <thead><tr>{result.columns.map((c) => <th key={c.key} scope="col" class={isNumericKind(c.kind) ? "rp-num" : undefined}>{c.label}</th>)}</tr></thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i}>{result.columns.map((c, j) => <td key={c.key} class={isNumericKind(c.kind) ? "rp-num" : undefined}>{displayCell(c.kind, row[j] ?? null)}</td>)}</tr>
              ))}
            </tbody>
            <tfoot><tr>{result.columns.map((c, j) => <td key={c.key} class={isNumericKind(c.kind) ? "rp-num" : undefined}>{displayCell(c.kind, result.totals[j] ?? null)}</td>)}</tr></tfoot>
          </table>
        </div>
      ) : <EmptyState title={t("rep.empty")} compact />}
    </section>
  );
}
