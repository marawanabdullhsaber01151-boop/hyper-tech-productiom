import "../copy/periods";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, StatusPill, Textarea, type Column } from "../design/components";
import { formatDate, formatDateTime } from "../lib/format";
import "./Engineering.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const label = (p: { year: number; month: number }) => `${p.year}-${String(p.month).padStart(2, "0")}`;

export interface PeriodRow {
  id: number; year: number; month: number; status: string; fiscalYear: string; endsOn: string; dueDate: string; late: boolean;
  closedByName?: string | null; closedAt?: string | null;
}
interface EventRow { id: number; year: number; month: number; action: string; reason: string | null; actorName: string; createdAt: string }
interface Check { pendingTransfers: number; openDisputes: number }

/** تبويب «الفترات»: إقفال الشهر (يوم الإقفال من الإعدادات) وإعادة الفتح بسبب، وسجل كل ده. */
export function PeriodsPanel({ data, closeDay, onChanged }: { data: PeriodRow[]; closeDay: number; onChanged: () => void }) {
  const [closing, setClosing] = useState<PeriodRow | null>(null);
  const [reopening, setReopening] = useState<PeriodRow | null>(null);
  const events = useQuery((signal) => api.get<{ items: EventRow[] }>("/ledger/period-events", { signal }), []);
  const today = cairoToday();
  const latestClosed = data.filter((p) => p.status === "closed").sort((a, b) => b.year * 100 + b.month - (a.year * 100 + a.month))[0];
  const lateCount = data.filter((p) => p.late).length;
  const refresh = () => { onChanged(); void events.refetch(); };
  const cols: Column<PeriodRow>[] = [
    { key: "p", header: t("pc.c.period"), cell: (p) => <span class="num" dir="ltr">{label(p)}</span>, mobile: "title" },
    { key: "f", header: t("pc.c.fy"), cell: (p) => p.fiscalYear },
    { key: "d", header: t("pc.c.due"), cell: (p) => formatDate(p.dueDate) },
    { key: "s", header: t("pc.c.status"), cell: (p) => <StatusPill tone={p.status === "closed" ? "neutral" : p.late ? "danger" : "success"}>{p.status === "closed" ? t("pc.s.closed") : p.late ? t("pc.s.late") : t("pc.s.open")}</StatusPill> },
    { key: "b", header: t("pc.c.by"), cell: (p) => p.closedByName ?? "—" },
    { key: "a", header: "", cell: (p) => p.status === "open"
      ? (p.endsOn < today ? <Button size="sm" onClick={() => setClosing(p)}>{t("pc.close")}</Button> : <span class="eng-muted">{t("pc.s.notEnded")}</span>)
      : (latestClosed?.id === p.id ? <Button size="sm" variant="ghost" onClick={() => setReopening(p)}>{t("pc.reopen")}</Button> : null) },
  ];
  const ecols: Column<EventRow>[] = [
    { key: "w", header: t("pc.h.when"), cell: (e) => formatDateTime(e.createdAt) },
    { key: "p", header: t("pc.h.period"), cell: (e) => <span class="num" dir="ltr">{label(e)}</span>, mobile: "title" },
    { key: "a", header: t("pc.h.action"), cell: (e) => (e.action === "closed" ? t("pc.h.closed") : t("pc.h.reopened")) },
    { key: "u", header: t("pc.h.who"), cell: (e) => e.actorName },
    { key: "r", header: t("pc.h.reason"), cell: (e) => e.reason ?? "—" },
  ];
  return (
    <div class="ad-stack">
      <p class="eng-muted">{t("pc.hint", { d: closeDay })}</p>
      {lateCount > 0 ? <InlineAlert tone="warn">{t("pc.lateAlert", { n: lateCount })}</InlineAlert> : null}
      <DataTable columns={cols} rows={data} rowKey={(p) => p.id} caption={t("pc.caption")} empty={<EmptyState compact title={t("pc.empty")} />} />
      <h3 class="eng-h">{t("pc.history")}</h3>
      {events.error ? <InlineAlert tone="warn">{t("pc.err")}</InlineAlert> : <DataTable columns={ecols} rows={events.data?.items ?? []} rowKey={(e) => e.id} caption={t("pc.history")} empty={<EmptyState compact title={t("pc.h.empty")} />} />}
      {closing ? <CloseDialog row={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); refresh(); }} /> : null}
      {reopening ? <ReopenDialog row={reopening} onClose={() => setReopening(null)} onDone={() => { setReopening(null); refresh(); }} /> : null}
    </div>
  );
}

function CloseDialog({ row, onClose, onDone }: { row: PeriodRow; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [note, setNote] = useState("");
  const check = useQuery((signal) => api.get<Check>("/ledger/periods/check", { signal }), []);
  const c = check.data;
  const go = async () => {
    const r = await act.run(() => api.post(`/ledger/periods/${row.id}/close`, { note: note.trim() || null }), t("pc.closed"));
    if (r) onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("pc.closeTitle", { p: label(row) })} description={t("pc.closeDesc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("pc.cancel")}</Button><Button loading={act.busy} onClick={() => void go()}>{t("pc.closeGo")}</Button></>}>
      <div class="eng-form">
        {c && c.pendingTransfers > 0 ? <InlineAlert tone="warn">{t("pc.warnTransfers", { n: c.pendingTransfers })}</InlineAlert> : null}
        {c && c.openDisputes > 0 ? <InlineAlert tone="warn">{t("pc.warnDisputes", { n: c.openDisputes })}</InlineAlert> : null}
        {c && c.pendingTransfers === 0 && c.openDisputes === 0 ? <p class="eng-muted">{t("pc.allClear")}</p> : null}
        <Field label={t("pc.note")}><Textarea value={note} maxLength={300} onInput={(e) => setNote(val(e))} /></Field>
      </div>
    </Dialog>
  );
}

function ReopenDialog({ row, onClose, onDone }: { row: PeriodRow; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [reason, setReason] = useState("");
  const go = async () => {
    const r = await act.run(() => api.post(`/ledger/periods/${row.id}/reopen`, { reason: reason.trim() }), t("pc.reopened"));
    if (r) onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("pc.reopenTitle", { p: label(row) })} description={t("pc.reopenDesc")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("pc.cancel")}</Button><Button loading={act.busy} disabled={reason.trim().length < 3} onClick={() => void go()}>{t("pc.reopenGo")}</Button></>}>
      <div class="eng-form">
        <Field label={t("pc.reason")} required><Textarea value={reason} maxLength={500} onInput={(e) => setReason(val(e))} /></Field>
      </div>
    </Dialog>
  );
}
