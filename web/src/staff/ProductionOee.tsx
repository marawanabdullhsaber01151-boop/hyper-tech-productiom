import "../copy/production";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, StatusPill, Textarea, type Column } from "../design/components";
import { formatNumber } from "../lib/format";
import { DOWNTIME_REASONS } from "./executionCore";
import { RANGE_PRESETS, canWriteStoppage, oeeTone, openMinutes, pctLabel, presetRange, rangeError, stoppageError, stoppagePayload, type OeeMachine, type OeeReportData, type OeeRow, type RangePreset } from "./oeeCore";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const reasonLabel = (r: string) => t(`prd.ex.dt.reason.${r}` as CopyKey);

/** التوقفات والكفاءة: حالة الماكينات (بدء/إنهاء توقف) + تقرير OEE بالفترة. */
export function ProductionOee() {
  const role = staffUser()?.role ?? "";
  const canWrite = canWriteStoppage(role);
  const machines = useQuery((signal) => api.get<OeeMachine[]>("/production-oee/machines", { signal }), []);
  const [range, setRange] = useState(() => presetRange("week"));
  const bad = rangeError(range.from, range.to);
  const report = useQuery((signal) => (bad ? Promise.resolve(undefined) : api.get<OeeReportData>(`/production-oee/report?from=${range.from}&to=${range.to}`, { signal })), [range.from, range.to]);
  const [startFor, setStartFor] = useState<OeeMachine | null>(null);
  const [endFor, setEndFor] = useState<OeeMachine | null>(null);
  const list = Array.isArray(machines.data) ? machines.data : [];
  const data = report.data;
  const refresh = async () => { await machines.refetch(); await report.refetch(); };

  const columns: Column<OeeRow>[] = [
    { key: "m", header: t("prd.oee.col.machine"), cell: (r) => <span><strong>{r.code}</strong> {r.name} {r.openStoppage ? <StatusPill tone="danger">{t("prd.oee.openNow")}</StatusPill> : null}</span>, mobile: "title" },
    { key: "a", header: t("prd.oee.col.availability"), cell: (r) => pctLabel(r.availability), numeric: true },
    { key: "p", header: t("prd.oee.col.performance"), cell: (r) => pctLabel(r.performance), numeric: true },
    { key: "q", header: t("prd.oee.col.quality"), cell: (r) => pctLabel(r.quality), numeric: true },
    { key: "o", header: t("prd.oee.col.oee"), cell: (r) => <StatusPill tone={oeeTone(r.oee)}>{pctLabel(r.oee)}</StatusPill>, numeric: true },
    { key: "d", header: t("prd.oee.col.downtime"), cell: (r) => formatNumber(r.downtimeMinutes), numeric: true, mobile: "hide" },
    { key: "s", header: t("prd.oee.col.stops"), cell: (r) => formatNumber(r.stoppages), numeric: true, mobile: "hide" },
  ];

  return (
    <div class="prd-form">
      <h3 class="prd-h">{t("prd.oee.title")}</h3>
      {machines.error ? <InlineAlert tone="warn">{t("prd.oee.loadFail")}</InlineAlert> : null}
      {!machines.loading && !machines.error && !list.length ? <p class="prd-muted">{t("prd.oee.noMachines")}</p> : null}
      {list.length ? (
        <ul class="prd-list">
          {list.map((m) => (
            <li key={m.id}>
              <strong>{m.code}</strong> {m.name}{" "}
              {m.openStoppage ? <StatusPill tone="danger">{t("prd.oee.stopped", { reason: reasonLabel(m.openStoppage.reasonCode), min: formatNumber(openMinutes(m.openStoppage.startedAt)) })}</StatusPill> : <StatusPill tone="success">{t("prd.oee.running")}</StatusPill>}{" "}
              {canWrite ? (m.openStoppage ? <Button size="sm" onClick={() => setEndFor(m)}>{t("prd.oee.end")}</Button> : <Button size="sm" variant="ghost" onClick={() => setStartFor(m)}>{t("prd.oee.start")}</Button>) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <h3 class="prd-h">{t("prd.oee.report")}</h3>
      <div class="prd-toolbar">
        {RANGE_PRESETS.map((p: RangePreset) => <Button key={p} size="sm" variant="ghost" onClick={() => setRange(presetRange(p))}>{t(`prd.oee.preset.${p}` as CopyKey)}</Button>)}
        <Input type="date" aria-label={t("prd.oee.from")} value={range.from} onInput={(e) => setRange({ ...range, from: val(e) })} />
        <Input type="date" aria-label={t("prd.oee.to")} value={range.to} onInput={(e) => setRange({ ...range, to: val(e) })} />
      </div>
      {bad ? <InlineAlert tone="warn">{t("prd.oee.rangeBad")}</InlineAlert> : null}
      {report.error ? <InlineAlert tone="warn">{t("prd.oee.reportFail")}</InlineAlert> : null}
      {data ? (
        <>
          <DataTable columns={columns} rows={data.machines} rowKey={(r) => r.machineId} caption={t("prd.oee.caption")} loading={report.loading} empty={<EmptyState title={t("prd.oee.empty")} compact />} />
          <p><strong>{t("prd.oee.total")}:</strong> {t("prd.oee.col.availability")} {pctLabel(data.total.availability)} | {t("prd.oee.col.performance")} {pctLabel(data.total.performance)} | {t("prd.oee.col.quality")} {pctLabel(data.total.quality)} | {t("prd.oee.col.oee")} {pctLabel(data.total.oee)}</p>
          {data.total.missingStandards > 0 ? <InlineAlert tone="warn">{t("prd.oee.missingStd", { n: formatNumber(data.total.missingStandards) })}</InlineAlert> : null}
          <p class="prd-muted">{t("prd.oee.assume", { days: formatNumber(data.workingDays) })}</p>
        </>
      ) : null}

      {startFor ? <StartDialog machine={startFor} onClose={() => setStartFor(null)} onDone={async () => { setStartFor(null); await refresh(); }} /> : null}
      {endFor ? <EndDialog machine={endFor} onClose={() => setEndFor(null)} onDone={async () => { setEndFor(null); await refresh(); }} /> : null}
    </div>
  );
}

function StartDialog({ machine, onClose, onDone }: { machine: OeeMachine; onClose: () => void; onDone: () => Promise<void> }) {
  const act = useAct();
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const err = stoppageError(reason, DOWNTIME_REASONS);
  const save = async () => {
    const ok = await act.run(async () => { await api.post<unknown>("/production-oee/stoppages", stoppagePayload(machine.id, reason, notes)); return true; }, t("prd.oee.startDone"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("prd.oee.startTitle", { name: machine.name })} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={err !== null} onClick={() => void save()}>{t("prd.oee.start")}</Button></>}>
      <div class="prd-form">
        <Field label={t("prd.oee.reason")} required>
          <Select value={reason} options={[{ value: "", label: t("prd.oee.reasonPick") }, ...DOWNTIME_REASONS.map((r) => ({ value: r, label: reasonLabel(r) }))]} onChange={(e) => setReason(val(e))} />
        </Field>
        <Field label={t("prd.oee.notes")}><Textarea value={notes} maxLength={1000} onInput={(e) => setNotes(val(e))} /></Field>
      </div>
    </Dialog>
  );
}

function EndDialog({ machine, onClose, onDone }: { machine: OeeMachine; onClose: () => void; onDone: () => Promise<void> }) {
  const act = useAct();
  const [notes, setNotes] = useState("");
  const stop = machine.openStoppage;
  const save = async () => {
    if (!stop) return;
    const n = notes.trim();
    const ok = await act.run(async () => { await api.post<unknown>(`/production-oee/stoppages/${stop.id}/end`, n ? { notes: n } : {}); return true; }, t("prd.oee.endDone"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("prd.oee.startTitle", { name: machine.name })} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} onClick={() => void save()}>{t("prd.oee.end")}</Button></>}>
      <div class="prd-form">
        {stop ? <p>{t("prd.oee.stopped", { reason: reasonLabel(stop.reasonCode), min: formatNumber(openMinutes(stop.startedAt)) })}</p> : null}
        <Field label={t("prd.oee.endNotes")}><Textarea value={notes} maxLength={1000} onInput={(e) => setNotes(val(e))} /></Field>
      </div>
    </Dialog>
  );
}
