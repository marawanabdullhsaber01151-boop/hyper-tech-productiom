import "../copy/foundation";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Checkbox, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, Tabs, Textarea, type Column } from "../design/components";
import { Plus } from "../design/icons";
import { formatDateTime, formatNumber } from "../lib/format";
import {
  LOCATION_TYPES, MACHINE_STATUSES, activeBlockers, activeReferences, canManageFoundation, centerError, centerPayload, confirmEnabled, crossesMidnight, dailyShiftMinutes, daysUntil, dueState, formatHours, formatSequence,
  foundationTabs, impactBody, isChairman, locationPath, locationPayload, machineError, machinePayload, machineStats, machineTone, parentCandidates, sequenceError, sequencePayload, shiftError, shiftNetMinutes, shiftPayload,
  todayISO, type AuditRow, type CenterRow, type FoundationTab, type Impact, type LocationRow, type MachineRow, type SequenceRow, type ShiftRow,
} from "./foundationCore";
import { Items } from "./FoundationItems";
import { joinNames } from "./recipesCore";
import "./Engineering.css";
import "./Planning.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const chk = (e: Event) => (e.target as HTMLInputElement).checked;
const list = <T,>(d: T[] | undefined): T[] => (Array.isArray(d) ? d : []);
const k = (key: string) => key as CopyKey;
type Kind = "location" | "work-center" | "machine" | "shift";
/** مسارات حرفية (مش ENDPOINT[kind]) عشان فاحص مستهلكي الـAPI يشوفها. */
const itemPath = (kind: Kind, id: number): string => {
  switch (kind) {
    case "location": return `/foundation/locations/${id}`;
    case "work-center": return `/foundation/work-centers/${id}`;
    case "machine": return `/foundation/machines/${id}`;
    case "shift": return `/foundation/shifts/${id}`;
  }
};
/** الإيقاف النهائي (retired) للماكينات بس. */
const machineStatusPath = (id: number): string => `/foundation/machines/${id}/status`;

/** البيانات الأساسية: مواقع، مراكز عمل، ماكينات، ورديات، عدادات، سجل. */
export function Foundation() {
  const role = staffUser()?.role ?? "";
  const allowed = foundationTabs(role);
  const [tab, setTab] = useState<FoundationTab>(() => {
    const start = new URLSearchParams(location.search).get("tab");
    return allowed.includes(start as FoundationTab) ? (start as FoundationTab) : (allowed[0] ?? "locations");
  });
  if (!canManageFoundation(role)) return <div class="ad-page"><InlineAlert tone="warn">{t("fnd.noAccess")}</InlineAlert></div>;
  const panels: Record<FoundationTab, ComponentChildren> = {
    locations: <Locations />, centers: <Centers />, machines: <Machines />, shifts: <Shifts />, items: <Items role={role} />, sequences: <Sequences chairman={isChairman(role)} />, audit: <Audit />,
  };
  return (
    <div class="ad-page">
      <div>
        <h1 class="ad-title">{t("fnd.title")}</h1>
        <p class="st-login__sub">{t("fnd.subtitle")}</p>
      </div>
      <Tabs value={tab} onChange={(v) => setTab(v as FoundationTab)} tabs={allowed.map((id) => ({ id, label: t(k(`fnd.tab.${id}`)), panel: panels[id] }))} />
    </div>
  );
}

/* ───────────── أدوات مشتركة ───────────── */

function ErrorBox({ q }: { q: { error: Error | null; refetch: () => Promise<unknown> | void } }) {
  return q.error ? <InlineAlert tone="danger" title={t("fnd.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert> : null;
}

const matches = (r: { code: string; name: string }, q: string) => !q.trim() || `${r.code} ${r.name}`.toLowerCase().includes(q.trim().toLowerCase());

function Toolbar({ search, setSearch, hide, setHide, onNew }: { search: string; setSearch: (s: string) => void; hide: boolean; setHide: (b: boolean) => void; onNew: () => void }) {
  return (
    <div class="eng-toolbar">
      <Input aria-label={t("fnd.search")} placeholder={t("fnd.search")} value={search} onInput={(e) => setSearch(val(e))} />
      <Checkbox label={t("fnd.hideInactive")} checked={hide} onChange={(e) => setHide(chk(e))} />
      <Button icon={Plus} onClick={onNew}>{t("fnd.new")}</Button>
    </div>
  );
}

function ActiveActions({ kind, row, onEdit, onChanged, extra }: { kind: Kind; row: { id: number; name: string; active: boolean }; onEdit: () => void; onChanged: () => void; extra?: ComponentChildren }) {
  const act = useAct();
  const [simulating, setSimulating] = useState(false);
  return (
    <div class="eng-actions">
      <Button size="sm" variant="secondary" onClick={onEdit}>{t("fnd.edit")}</Button>
      {extra}
      {row.active
        ? <Button size="sm" variant="ghost" onClick={() => setSimulating(true)}>{t("fnd.deactivate")}</Button>
        : <Button size="sm" variant="ghost" disabled={act.busy} onClick={() => void act.run(async () => { await api.patch<unknown>(itemPath(kind, row.id), { active: true }); onChanged(); }, t("fnd.activated"))}>{t("fnd.activate")}</Button>}
      {simulating ? <ImpactDialog kind={kind} id={row.id} name={row.name} onClose={() => setSimulating(false)} onDone={() => { setSimulating(false); onChanged(); }} /> : null}
    </div>
  );
}

/** محاكي الأثر: بيوري المراجع الحيّة والتاريخية قبل الإيقاف، ولو فيه حيّة بيطلب سبب صريح. */
function ImpactDialog({ kind, id, name, onClose, onDone, retire }: { kind: Kind; id: number; name: string; onClose: () => void; onDone: () => void; retire?: boolean }) {
  const q = useQuery((signal) => api.get<Impact>(`/foundation/impact/${kind}/${id}`, { signal }), [kind, id]);
  const act = useAct();
  const [reason, setReason] = useState("");
  const impact = q.data ?? null;
  const blockers = impact ? activeBlockers(impact) : [];
  const refs = impact ? activeReferences(impact) : [];
  const confirm = async () => {
    if (!impact) return;
    const body = impactBody(reason, blockers.length > 0);
    const ok = await act.run(async () => {
      if (retire) await api.patch<unknown>(machineStatusPath(id), { status: "retired", ...(blockers.length ? { overrideReason: body.overrideReason } : {}) });
      else await api.patch<unknown>(itemPath(kind, id), body);
      return true;
    }, t("fnd.deactivated"));
    if (ok) onDone();
  };
  const row = (b: { type: string; count: number; label: string; examples?: string[] }) => (
    <li key={b.type}><strong>{formatNumber(b.count)}</strong> {b.label}{b.examples?.length ? <span class="eng-muted"> - {t("fnd.i.examples", { names: joinNames(b.examples) })}</span> : null}</li>
  );
  return (
    <Dialog open onClose={onClose} title={t("fnd.i.title", { name })} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button variant={blockers.length ? "danger" : "primary"} loading={act.busy} disabled={!confirmEnabled(impact, reason)} onClick={() => void confirm()}>{blockers.length ? t("fnd.i.confirmAnyway") : t("fnd.i.confirm")}</Button></>}>
      <div class="eng-form">
        {q.error ? <InlineAlert tone="danger">{q.error.message}</InlineAlert> : null}
        {!impact && !q.error ? <p class="eng-muted">{t("fnd.i.loading")}</p> : null}
        {impact && !blockers.length && !refs.length ? <InlineAlert tone="success">{t("fnd.i.clean")}</InlineAlert> : null}
        {blockers.length ? <InlineAlert tone="warn" title={t("fnd.i.blockers")}><ul class="eng-issues">{blockers.map(row)}</ul></InlineAlert> : null}
        {refs.length ? <div><h3 class="eng-h">{t("fnd.i.refs")}</h3><ul class="eng-issues">{refs.map(row)}</ul></div> : null}
        {blockers.length ? <Field label={t("fnd.i.reason")} hint={t("fnd.i.reasonHint")} required><Textarea value={reason} maxLength={500} onInput={(e) => setReason(val(e))} /></Field> : null}
      </div>
    </Dialog>
  );
}

function FormDialog({ title, err, errorText, onClose, onSave, children }: { title: string; err: string | null; errorText?: string; onClose: () => void; onSave: () => Promise<unknown>; children: ComponentChildren }) {
  const act = useAct();
  return (
    <Dialog open onClose={onClose} title={title} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={err !== null} onClick={() => void act.run(async () => { await onSave(); return true; }, t("fnd.saved")).then((ok) => { if (ok) onClose(); })}>{t("common.save")}</Button></>}>
      <div class="eng-form">{children}{err && errorText ? <p class="eng-warn" role="alert">{errorText}</p> : null}</div>
    </Dialog>
  );
}

const CodeName = ({ f, set, err }: { f: { code: string; name: string }; set: (key: "code" | "name") => (e: Event) => void; err: string | null }) => (
  <>
    <Field label={t("fnd.f.code")} required error={err === "code" ? t("fnd.f.err.code") : undefined}><Input value={f.code} maxLength={80} onInput={set("code")} /></Field>
    <Field label={t("fnd.f.name")} required error={err === "name" ? t("fnd.f.err.name") : undefined}><Input value={f.name} maxLength={160} onInput={set("name")} /></Field>
  </>
);

const statusCol = <T extends { active: boolean }>(): Column<T> => ({ key: "st", header: t("fnd.col.status"), cell: (r) => <StatusPill tone={r.active ? "success" : "neutral"}>{r.active ? t("fnd.active") : t("fnd.inactive")}</StatusPill> });

/* ───────────── المواقع ───────────── */

function Locations() {
  const q = useQuery((signal) => api.get<LocationRow[]>("/foundation/locations", { signal }), []);
  const rows = list(q.data);
  const [search, setSearch] = useState("");
  const [hide, setHide] = useState(false);
  const [editing, setEditing] = useState<LocationRow | "new" | null>(null);
  const shown = rows.filter((r) => matches(r, search) && (!hide || r.active));
  const cols: Column<LocationRow>[] = [
    { key: "code", header: t("fnd.col.code"), cell: (r) => <strong>{r.code}</strong>, mobile: "title" },
    { key: "path", header: t("fnd.l.col.path"), cell: (r) => locationPath(rows, r.id) },
    { key: "type", header: t("fnd.l.col.type"), cell: (r) => t(k(`fnd.l.type.${r.locationType}`)), mobile: "hide" },
    { key: "flags", header: t("fnd.l.col.flags"), cell: (r) => joinNames([r.allowsInventory ? t("fnd.l.flag.inv") : "", r.allowsProduction ? t("fnd.l.flag.prod") : "", r.requiresQuarantine ? t("fnd.l.flag.quar") : ""].filter(Boolean)), mobile: "hide" },
    statusCol<LocationRow>(),
    { key: "act", header: t("fnd.col.action"), cell: (r) => <ActiveActions kind="location" row={r} onEdit={() => setEditing(r)} onChanged={() => void q.refetch()} /> },
  ];
  return (
    <section class="eng-stack">
      <div class="eng-stats">
        <Stat label={t("fnd.l.stat.total")} value={formatNumber(rows.length)} />
        <Stat label={t("fnd.l.stat.active")} value={formatNumber(rows.filter((r) => r.active).length)} />
      </div>
      <Toolbar search={search} setSearch={setSearch} hide={hide} setHide={setHide} onNew={() => setEditing("new")} />
      <ErrorBox q={q} />
      <DataTable columns={cols} rows={shown} rowKey={(r) => r.id} caption={t("fnd.tab.locations")} loading={q.loading} empty={<EmptyState title={rows.length ? t("fnd.emptyFiltered") : t("fnd.empty")} compact />} />
      {editing ? <LocationDialog rows={rows} row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => void q.refetch()} /> : null}
    </section>
  );
}

function LocationDialog({ rows, row, onClose, onSaved }: { rows: LocationRow[]; row: LocationRow | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: row?.code ?? "", name: row?.name ?? "", locationType: row?.locationType ?? "warehouse", parentId: row?.parentId ? String(row.parentId) : "", allowsInventory: row?.allowsInventory ?? true, allowsProduction: row?.allowsProduction ?? false, requiresQuarantine: row?.requiresQuarantine ?? false, notes: row?.notes ?? "" });
  const set = (key: "code" | "name") => (e: Event) => setF({ ...f, [key]: val(e) });
  const err = !f.code.trim() ? "code" : !f.name.trim() ? "name" : null;
  const parents = parentCandidates(rows, row?.id ?? null);
  return (
    <FormDialog title={row ? t("fnd.edit") : t("fnd.new")} err={err} onClose={onClose} onSave={async () => { if (row) await api.patch<unknown>(`/foundation/locations/${row.id}`, locationPayload(f)); else await api.post<unknown>("/foundation/locations", locationPayload(f)); onSaved(); }}>
      <CodeName f={f} set={set} err={err} />
      <Field label={t("fnd.l.type")}><Select value={f.locationType} onChange={(e) => setF({ ...f, locationType: val(e) })} options={LOCATION_TYPES.map((x) => ({ value: x, label: t(k(`fnd.l.type.${x}`)) }))} /></Field>
      <Field label={t("fnd.l.parent")}><Select value={f.parentId} onChange={(e) => setF({ ...f, parentId: val(e) })} options={[{ value: "", label: t("fnd.l.parentNone") }, ...parents.map((p) => ({ value: String(p.id), label: locationPath(rows, p.id) }))]} /></Field>
      <Checkbox label={t("fnd.l.inv")} checked={f.allowsInventory} onChange={(e) => setF({ ...f, allowsInventory: chk(e) })} />
      <Checkbox label={t("fnd.l.prod")} checked={f.allowsProduction} onChange={(e) => setF({ ...f, allowsProduction: chk(e) })} />
      <Checkbox label={t("fnd.l.quar")} checked={f.requiresQuarantine} onChange={(e) => setF({ ...f, requiresQuarantine: chk(e) })} />
      <Field label={t("fnd.f.notes")}><Textarea value={f.notes} maxLength={1000} onInput={(e) => setF({ ...f, notes: val(e) })} /></Field>
    </FormDialog>
  );
}

/* ───────────── مراكز العمل ───────────── */

function Centers() {
  const q = useQuery((signal) => api.get<CenterRow[]>("/foundation/work-centers", { signal }), []);
  const locQ = useQuery((signal) => api.get<LocationRow[]>("/foundation/locations", { signal }), []);
  const machQ = useQuery((signal) => api.get<MachineRow[]>("/foundation/machines", { signal }), []);
  const rows = list(q.data);
  const locs = list(locQ.data);
  const machines = list(machQ.data);
  const [search, setSearch] = useState("");
  const [hide, setHide] = useState(false);
  const [editing, setEditing] = useState<CenterRow | "new" | null>(null);
  const shown = rows.filter((r) => matches(r, search) && (!hide || r.active));
  const cols: Column<CenterRow>[] = [
    { key: "code", header: t("fnd.col.code"), cell: (r) => <strong>{r.code}</strong>, mobile: "title" },
    { key: "name", header: t("fnd.col.name"), cell: (r) => r.name },
    { key: "type", header: t("fnd.c.col.type"), cell: (r) => r.centerType, mobile: "hide" },
    { key: "loc", header: t("fnd.c.col.location"), cell: (r) => (r.locationId ? locationPath(locs, r.locationId) : "-"), mobile: "hide" },
    { key: "cap", header: t("fnd.c.col.capacity"), cell: (r) => formatNumber(r.capacityMinutesPerShift), mobile: "hide" },
    { key: "mach", header: t("fnd.c.col.machines"), cell: (r) => formatNumber(machines.filter((m) => m.workCenterId === r.id && m.active).length), mobile: "hide" },
    statusCol<CenterRow>(),
    { key: "act", header: t("fnd.col.action"), cell: (r) => <ActiveActions kind="work-center" row={r} onEdit={() => setEditing(r)} onChanged={() => void q.refetch()} /> },
  ];
  return (
    <section class="eng-stack">
      <div class="eng-stats">
        <Stat label={t("fnd.c.stat.total")} value={formatNumber(rows.length)} />
        <Stat label={t("fnd.c.stat.active")} value={formatNumber(rows.filter((r) => r.active).length)} />
      </div>
      <Toolbar search={search} setSearch={setSearch} hide={hide} setHide={setHide} onNew={() => setEditing("new")} />
      <ErrorBox q={q} />
      <DataTable columns={cols} rows={shown} rowKey={(r) => r.id} caption={t("fnd.tab.centers")} loading={q.loading} empty={<EmptyState title={rows.length ? t("fnd.emptyFiltered") : t("fnd.empty")} compact />} />
      {editing ? <CenterDialog locs={locs} row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => void q.refetch()} /> : null}
    </section>
  );
}

function CenterDialog({ locs, row, onClose, onSaved }: { locs: LocationRow[]; row: CenterRow | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: row?.code ?? "", name: row?.name ?? "", centerType: row?.centerType ?? "production_line", locationId: row?.locationId ? String(row.locationId) : "", capacity: row ? String(row.capacityMinutesPerShift) : "480", notes: row?.notes ?? "" });
  const set = (key: "code" | "name") => (e: Event) => setF({ ...f, [key]: val(e) });
  const err = centerError(f);
  return (
    <FormDialog title={row ? t("fnd.edit") : t("fnd.new")} err={err} onClose={onClose} onSave={async () => { if (row) await api.patch<unknown>(`/foundation/work-centers/${row.id}`, centerPayload(f)); else await api.post<unknown>("/foundation/work-centers", centerPayload(f)); onSaved(); }}>
      <CodeName f={f} set={set} err={err} />
      <Field label={t("fnd.c.type")} hint={t("fnd.c.typeHint")}><Input value={f.centerType} maxLength={80} onInput={(e) => setF({ ...f, centerType: val(e) })} /></Field>
      <Field label={t("fnd.c.location")}><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: val(e) })} options={[{ value: "", label: t("fnd.c.locationNone") }, ...locs.filter((l) => l.active).map((l) => ({ value: String(l.id), label: locationPath(locs, l.id) }))]} /></Field>
      <Field label={t("fnd.c.capacity")} hint={t("fnd.c.capacityHint")} error={err === "capacity" ? t("fnd.c.err.capacity") : undefined}><Input inputMode="numeric" value={f.capacity} onInput={(e) => setF({ ...f, capacity: val(e) })} /></Field>
      <Field label={t("fnd.f.notes")}><Textarea value={f.notes} maxLength={1000} onInput={(e) => setF({ ...f, notes: val(e) })} /></Field>
    </FormDialog>
  );
}

/* ───────────── الماكينات ───────────── */

function DueCell({ date, today }: { date: string | null; today: string }) {
  const s = dueState(date, today);
  if (!date || s === "none") return <span class="eng-muted">{t("fnd.m.noDate")}</span>;
  const d = daysUntil(date, today);
  const label = s === "overdue" ? t("fnd.m.due.overdue", { n: Math.abs(d) }) : d === 0 ? t("fnd.m.due.today") : t("fnd.m.due.soon", { n: d });
  return s === "ok" ? <>{date}</> : <StatusPill tone={s === "overdue" ? "danger" : "warn"}>{label}</StatusPill>;
}

function Machines() {
  const q = useQuery((signal) => api.get<MachineRow[]>("/foundation/machines", { signal }), []);
  const centersQ = useQuery((signal) => api.get<CenterRow[]>("/foundation/work-centers", { signal }), []);
  const rows = list(q.data);
  const centers = list(centersQ.data);
  const today = todayISO();
  const stats = machineStats(rows, today);
  const [search, setSearch] = useState("");
  const [hide, setHide] = useState(false);
  const [editing, setEditing] = useState<MachineRow | "new" | null>(null);
  const [status, setStatus] = useState<MachineRow | null>(null);
  const shown = rows.filter((r) => matches(r, search) && (!hide || r.active));
  const cols: Column<MachineRow>[] = [
    { key: "code", header: t("fnd.col.code"), cell: (r) => <strong>{r.code}</strong>, mobile: "title" },
    { key: "name", header: t("fnd.col.name"), cell: (r) => r.name },
    { key: "center", header: t("fnd.m.col.center"), cell: (r) => centers.find((c) => c.id === r.workCenterId)?.name ?? "-", mobile: "hide" },
    { key: "ms", header: t("fnd.m.col.status"), cell: (r) => <StatusPill tone={machineTone(r.status)}>{t(k(`fnd.m.status.${r.status}`))}</StatusPill> },
    { key: "cal", header: t("fnd.m.col.calibration"), cell: (r) => <DueCell date={r.calibrationDueDate} today={today} />, mobile: "hide" },
    { key: "mnt", header: t("fnd.m.col.maintenance"), cell: (r) => <DueCell date={r.maintenanceDueDate} today={today} />, mobile: "hide" },
    statusCol<MachineRow>(),
    { key: "act", header: t("fnd.col.action"), cell: (r) => <ActiveActions kind="machine" row={r} onEdit={() => setEditing(r)} onChanged={() => void q.refetch()} extra={<Button size="sm" variant="secondary" onClick={() => setStatus(r)}>{t("fnd.m.changeStatus")}</Button>} /> },
  ];
  return (
    <section class="eng-stack">
      <div class="eng-stats">
        <Stat label={t("fnd.m.stat.total")} value={formatNumber(stats.total)} />
        <Stat label={t("fnd.m.stat.active")} value={formatNumber(stats.active)} />
        <Stat label={t("fnd.m.stat.down")} value={formatNumber(stats.down)} />
        <Stat label={t("fnd.m.stat.overdue")} value={formatNumber(stats.overdue)} />
        <Stat label={t("fnd.m.stat.soon")} value={formatNumber(stats.soon)} />
      </div>
      <Toolbar search={search} setSearch={setSearch} hide={hide} setHide={setHide} onNew={() => setEditing("new")} />
      <ErrorBox q={q} />
      <DataTable columns={cols} rows={shown} rowKey={(r) => r.id} caption={t("fnd.tab.machines")} loading={q.loading} empty={<EmptyState title={rows.length ? t("fnd.emptyFiltered") : t("fnd.empty")} compact />} />
      {editing ? <MachineDialog centers={centers} row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => void q.refetch()} /> : null}
      {status ? <MachineStatusDialog row={status} onClose={() => setStatus(null)} onDone={() => { setStatus(null); void q.refetch(); }} /> : null}
    </section>
  );
}

function MachineDialog({ centers, row, onClose, onSaved }: { centers: CenterRow[]; row: MachineRow | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: row?.code ?? "", name: row?.name ?? "", workCenterId: row ? String(row.workCenterId) : "", serialNumber: row?.serialNumber ?? "", calibrationDueDate: row?.calibrationDueDate ?? "", maintenanceDueDate: row?.maintenanceDueDate ?? "", notes: row?.notes ?? "" });
  const set = (key: "code" | "name") => (e: Event) => setF({ ...f, [key]: val(e) });
  const err = machineError(f);
  return (
    <FormDialog title={row ? t("fnd.edit") : t("fnd.new")} err={err} onClose={onClose} onSave={async () => { if (row) await api.patch<unknown>(`/foundation/machines/${row.id}`, machinePayload(f)); else await api.post<unknown>("/foundation/machines", machinePayload(f)); onSaved(); }}>
      <CodeName f={f} set={set} err={err} />
      <Field label={t("fnd.m.center")} required error={err === "center" ? t("fnd.m.err.center") : undefined}><Select value={f.workCenterId} onChange={(e) => setF({ ...f, workCenterId: val(e) })} options={[{ value: "", label: t("fnd.m.centerPick") }, ...centers.filter((c) => c.active || String(c.id) === f.workCenterId).map((c) => ({ value: String(c.id), label: `${c.code} | ${c.name}` }))]} /></Field>
      <Field label={t("fnd.m.serial")}><Input value={f.serialNumber} maxLength={120} onInput={(e) => setF({ ...f, serialNumber: val(e) })} /></Field>
      <Field label={t("fnd.m.calibration")} error={err === "calibration" ? t("fnd.m.err.date") : undefined}><Input type="date" value={f.calibrationDueDate} onInput={(e) => setF({ ...f, calibrationDueDate: val(e) })} /></Field>
      <Field label={t("fnd.m.maintenance")} error={err === "maintenance" ? t("fnd.m.err.date") : undefined}><Input type="date" value={f.maintenanceDueDate} onInput={(e) => setF({ ...f, maintenanceDueDate: val(e) })} /></Field>
      <Field label={t("fnd.f.notes")}><Textarea value={f.notes} maxLength={1000} onInput={(e) => setF({ ...f, notes: val(e) })} /></Field>
    </FormDialog>
  );
}

function MachineStatusDialog({ row, onClose, onDone }: { row: MachineRow; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [status, setStatus] = useState(row.status);
  const [reason, setReason] = useState("");
  if (status === "retired" && row.status !== "retired") {
    return <ImpactDialog kind="machine" id={row.id} name={row.name} retire onClose={onClose} onDone={onDone} />;
  }
  return (
    <Dialog open onClose={onClose} title={t("fnd.m.statusTitle", { name: row.name })} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={act.busy} disabled={status === row.status} onClick={() => void act.run(async () => { await api.patch<unknown>(`/foundation/machines/${row.id}/status`, { status, ...(reason.trim() ? { reason: reason.trim() } : {}) }); return true; }, t("fnd.m.statusSaved")).then((ok) => { if (ok) onDone(); })}>{t("common.save")}</Button></>}>
      <div class="eng-form">
        <Field label={t("fnd.m.status")}><Select value={status} onChange={(e) => setStatus(val(e))} options={MACHINE_STATUSES.map((s) => ({ value: s, label: t(k(`fnd.m.status.${s}`)) }))} /></Field>
        <Field label={t("fnd.m.statusReason")}><Input value={reason} maxLength={300} onInput={(e) => setReason(val(e))} /></Field>
      </div>
    </Dialog>
  );
}

/* ───────────── الورديات ───────────── */

function Shifts() {
  const q = useQuery((signal) => api.get<ShiftRow[]>("/foundation/shifts", { signal }), []);
  const rows = list(q.data);
  const [search, setSearch] = useState("");
  const [hide, setHide] = useState(false);
  const [editing, setEditing] = useState<ShiftRow | "new" | null>(null);
  const shown = rows.filter((r) => matches(r, search) && (!hide || r.active));
  const cols: Column<ShiftRow>[] = [
    { key: "code", header: t("fnd.col.code"), cell: (r) => <strong>{r.code}</strong>, mobile: "title" },
    { key: "name", header: t("fnd.col.name"), cell: (r) => r.name },
    { key: "time", header: t("fnd.s.col.time"), cell: (r) => <>{r.startTime} - {r.endTime}{crossesMidnight(r.startTime, r.endTime) ? <> <StatusPill tone="info">{t("fnd.s.night")}</StatusPill></> : null}</> },
    { key: "brk", header: t("fnd.s.col.break"), cell: (r) => formatNumber(r.breakMinutes), mobile: "hide" },
    { key: "net", header: t("fnd.s.col.net"), cell: (r) => formatHours(shiftNetMinutes(r.startTime, r.endTime, r.breakMinutes)), mobile: "hide" },
    statusCol<ShiftRow>(),
    { key: "act", header: t("fnd.col.action"), cell: (r) => <ActiveActions kind="shift" row={r} onEdit={() => setEditing(r)} onChanged={() => void q.refetch()} /> },
  ];
  return (
    <section class="eng-stack">
      <div class="eng-stats">
        <Stat label={t("fnd.s.stat.total")} value={formatNumber(rows.length)} />
        <Stat label={t("fnd.s.stat.active")} value={formatNumber(rows.filter((r) => r.active).length)} />
        <Stat label={t("fnd.s.stat.minutes")} value={formatNumber(dailyShiftMinutes(rows))} />
      </div>
      <Toolbar search={search} setSearch={setSearch} hide={hide} setHide={setHide} onNew={() => setEditing("new")} />
      <ErrorBox q={q} />
      <DataTable columns={cols} rows={shown} rowKey={(r) => r.id} caption={t("fnd.tab.shifts")} loading={q.loading} empty={<EmptyState title={rows.length ? t("fnd.emptyFiltered") : t("fnd.empty")} compact />} />
      {editing ? <ShiftDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => void q.refetch()} /> : null}
    </section>
  );
}

function ShiftDialog({ row, onClose, onSaved }: { row: ShiftRow | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: row?.code ?? "", name: row?.name ?? "", startTime: row?.startTime ?? "08:00", endTime: row?.endTime ?? "16:00", breakMinutes: row ? String(row.breakMinutes) : "30" });
  const set = (key: "code" | "name") => (e: Event) => setF({ ...f, [key]: val(e) });
  const err = shiftError(f);
  const net = shiftNetMinutes(f.startTime, f.endTime, Number(f.breakMinutes) || 0);
  return (
    <FormDialog title={row ? t("fnd.edit") : t("fnd.new")} err={err} onClose={onClose} onSave={async () => { if (row) await api.patch<unknown>(`/foundation/shifts/${row.id}`, shiftPayload(f)); else await api.post<unknown>("/foundation/shifts", shiftPayload(f)); onSaved(); }}>
      <CodeName f={f} set={set} err={err} />
      <Field label={t("fnd.s.start")} required error={err === "start" ? t("fnd.s.err.start") : undefined}><Input type="time" value={f.startTime} onInput={(e) => setF({ ...f, startTime: val(e) })} /></Field>
      <Field label={t("fnd.s.end")} required error={err === "end" ? t("fnd.s.err.end") : undefined}><Input type="time" value={f.endTime} onInput={(e) => setF({ ...f, endTime: val(e) })} /></Field>
      <Field label={t("fnd.s.break")} error={err === "break" ? t("fnd.s.err.break") : err === "length" ? t("fnd.s.err.length") : undefined}><Input inputMode="numeric" value={f.breakMinutes} onInput={(e) => setF({ ...f, breakMinutes: val(e) })} /></Field>
      {net > 0 ? <p class="eng-muted">{t("fnd.s.net", { hours: formatHours(net) })}{crossesMidnight(f.startTime, f.endTime) ? ` - ${t("fnd.s.night")}` : ""}</p> : null}
    </FormDialog>
  );
}

/* ───────────── العدّادات ───────────── */

function Sequences({ chairman }: { chairman: boolean }) {
  const q = useQuery((signal) => api.get<SequenceRow[]>("/foundation/number-sequences", { signal }), []);
  const rows = list(q.data);
  const [editing, setEditing] = useState<SequenceRow | null>(null);
  const cols: Column<SequenceRow>[] = [
    { key: "key", header: t("fnd.q.col.key"), cell: (r) => <strong>{r.sequenceKey}</strong>, mobile: "title" },
    { key: "next", header: t("fnd.q.col.next"), cell: (r) => formatNumber(r.nextValue), mobile: "hide" },
    { key: "prev", header: t("fnd.q.col.preview"), cell: (r) => formatSequence(r.prefix, r.padding, r.nextValue) },
    ...(chairman ? [{ key: "act", header: t("fnd.col.action"), cell: (r: SequenceRow) => <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>{t("fnd.edit")}</Button> } satisfies Column<SequenceRow>] : []),
  ];
  return (
    <section class="eng-stack">
      <h2 class="eng-h">{t("fnd.q.title")}</h2>
      <p class="eng-muted">{t("fnd.q.hint")}</p>
      {!chairman ? <p class="eng-muted">{t("fnd.q.chairmanOnly")}</p> : null}
      <ErrorBox q={q} />
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} caption={t("fnd.q.title")} loading={q.loading} empty={<EmptyState title={t("fnd.empty")} compact />} />
      {editing ? <SequenceDialog row={editing} onClose={() => setEditing(null)} onSaved={() => void q.refetch()} /> : null}
    </section>
  );
}

function SequenceDialog({ row, onClose, onSaved }: { row: SequenceRow; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ prefix: row.prefix, padding: String(row.padding), nextValue: String(row.nextValue) });
  const err = sequenceError(f, row.nextValue);
  const pad = Number(f.padding), next = Number(f.nextValue);
  return (
    <FormDialog title={row.sequenceKey} err={err} onClose={onClose} onSave={async () => { await api.patch<unknown>(`/foundation/number-sequences/${row.id}`, sequencePayload(f)); onSaved(); }}>
      <Field label={t("fnd.q.prefix")} required error={err === "prefix" ? t("fnd.q.err.prefix") : undefined}><Input value={f.prefix} maxLength={30} onInput={(e) => setF({ ...f, prefix: val(e) })} /></Field>
      <Field label={t("fnd.q.padding")} required error={err === "padding" ? t("fnd.q.err.padding") : undefined}><Input inputMode="numeric" value={f.padding} onInput={(e) => setF({ ...f, padding: val(e) })} /></Field>
      <Field label={t("fnd.q.next")} required error={err === "next" ? t("fnd.q.err.next") : err === "lower" ? t("fnd.q.err.lower") : undefined}><Input inputMode="numeric" value={f.nextValue} onInput={(e) => setF({ ...f, nextValue: val(e) })} /></Field>
      {!err && pad > 0 && next > 0 ? <p class="eng-ok">{t("fnd.q.preview", { value: formatSequence(f.prefix.trim(), pad, next) })}</p> : null}
    </FormDialog>
  );
}

/* ───────────── السجل ───────────── */

function Audit() {
  const q = useQuery((signal) => api.get<AuditRow[]>("/foundation/audit?limit=100", { signal }), []);
  const rows = list(q.data);
  const cols: Column<AuditRow>[] = [
    { key: "when", header: t("fnd.a.col.when"), cell: (r) => formatDateTime(r.createdAt), mobile: "title" },
    { key: "ent", header: t("fnd.a.col.entity"), cell: (r) => `${t(k(`fnd.a.ent.${r.entityType}`))}${r.entityId ? ` #${r.entityId}` : ""}` },
    { key: "act", header: t("fnd.a.col.action"), cell: (r) => t(k(`fnd.a.act.${r.action}`)) },
    { key: "who", header: t("fnd.a.col.actor"), cell: (r) => `${r.actorRole} #${r.actorId}`, mobile: "hide" },
    { key: "why", header: t("fnd.a.col.reason"), cell: (r) => r.reason ?? "-", mobile: "hide" },
  ];
  return (
    <section class="eng-stack">
      <h2 class="eng-h">{t("fnd.a.title")}</h2>
      <ErrorBox q={q} />
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} caption={t("fnd.a.title")} loading={q.loading} empty={<EmptyState title={t("fnd.a.empty")} compact />} />
    </section>
  );
}
