import "../copy/settings";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, ConfirmDialog, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, PasswordInput, Select, Stat, StatusPill, type Column, type Option } from "../design/components";
import { formatNumber } from "../lib/format";
import {
  EMPTY_RULE, EMPTY_USER, cacheKeys, filterUsers, rangeParts, ruleError, rulePayload, ruleTogglePayload, sortRules, uptimeParts, userChanged, userError, userFormOf, userPayload,
  type RuleForm, type RuleRow, type SystemInfo, type UserForm, type UserRow,
} from "./settingsAdminCore";
import "./Activity.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/** تبويب «المستخدمون»: قايمة الموظفين وإضافتهم وتعديلهم وإيقافهم. */
export function UsersPanel() {
  const list = useQuery((signal) => api.get<UserRow[]>("/users", { signal }), []);
  const roles = useQuery((signal) => api.get<Option[]>("/governance/roles", { signal }), []);
  const act = useAct();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "active" | "inactive">("");
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const roleOptions = arr<Option>(roles.data);
  const roleLabel = (r: string) => roleOptions.find((o) => o.value === r)?.label ?? r;
  const rows = filterUsers(arr<UserRow>(list.data), q, status);
  const cols: Column<UserRow>[] = [
    { key: "n", header: t("usr.col.name"), cell: (u) => <strong>{u.fullName}</strong>, mobile: "title" },
    { key: "u", header: t("usr.col.username"), cell: (u) => u.username },
    { key: "r", header: t("usr.col.role"), cell: (u) => roleLabel(u.role) },
    { key: "s", header: t("usr.col.status"), cell: (u) => <StatusPill tone={u.status === "active" ? "success" : "neutral"}>{t(u.status === "active" ? "usr.active" : "usr.inactive")}</StatusPill> },
    { key: "x", header: t("usr.col.do"), cell: (u) => (
      <div class="act-toolbar">
        <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>{t("usr.edit")}</Button>
        <Button size="sm" variant="ghost" onClick={() => setDeleting(u)}>{t("usr.delete")}</Button>
      </div>
    ) },
  ];
  return (
    <div class="act-list">
      <p class="st-login__sub">{t("usr.intro")}</p>
      <div class="act-toolbar">
        <Input value={q} placeholder={t("usr.search")} aria-label={t("usr.search")} onInput={(e) => setQ(val(e))} />
        <Select value={status} options={[{ value: "", label: t("usr.filter.all") }, { value: "active", label: t("usr.filter.active") }, { value: "inactive", label: t("usr.filter.inactive") }]} onChange={(e) => setStatus(val(e) as typeof status)} />
        <Button onClick={() => setEditing("new")}>{t("usr.add")}</Button>
      </div>
      {list.error ? <InlineAlert tone="warn">{t("usr.loadFail")}</InlineAlert> : null}
      <DataTable columns={cols} rows={rows} rowKey={(u) => u.id} caption={t("usr.caption")} loading={list.loading} empty={<EmptyState title={t("usr.empty")} compact />} />
      {editing ? <UserDialog user={editing === "new" ? null : editing} roles={roleOptions} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await list.refetch(); }} /> : null}
      <ConfirmDialog open={!!deleting} danger loading={act.busy} onClose={() => setDeleting(null)} title={t("usr.confirmDelete")}
        onConfirm={async () => { const u = deleting; if (!u) return; const ok = await act.run(async () => { await api.delete<unknown>(`/users/${u.id}`); return true; }, t("usr.deleted")); if (ok) { setDeleting(null); await list.refetch(); } }} />
    </div>
  );
}

function UserDialog({ user, roles, onClose, onDone }: { user: UserRow | null; roles: Option[]; onClose: () => void; onDone: () => Promise<void> }) {
  const act = useAct();
  const [f, setF] = useState<UserForm>(user ? userFormOf(user) : EMPTY_USER);
  const [tried, setTried] = useState(false);
  const editing = !!user;
  const err = userError(f, editing);
  const set = (k: keyof UserForm) => (e: Event) => setF({ ...f, [k]: val(e) } as UserForm);
  const show = (code: string) => (tried && err === code ? t(`usr.err.${code}` as CopyKey) : undefined);
  const submit = async () => {
    setTried(true);
    if (err) return;
    if (user && !userChanged(f, user)) { onClose(); return; }
    const ok = await act.run(async () => {
      if (user) await api.patch<unknown>(`/users/${user.id}`, userPayload(f, user));
      else await api.post<unknown>("/users", userPayload(f));
      return true;
    }, t(user ? "usr.updated" : "usr.created"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t(user ? "usr.title.edit" : "usr.title.add")} footer={<><Button variant="ghost" onClick={onClose}>{t("usr.cancel")}</Button><Button loading={act.busy} onClick={() => void submit()}>{t("usr.save")}</Button></>}>
      <div class="act-list">
        <Field label={t("usr.f.username")} error={show("username")}><Input value={f.username} maxLength={60} autocomplete="off" onInput={set("username")} /></Field>
        <Field label={t("usr.f.fullName")} error={show("fullName")}><Input value={f.fullName} maxLength={120} onInput={set("fullName")} /></Field>
        <Field label={t("usr.f.role")} error={show("role")}><Select value={f.role} placeholder={t("usr.f.pick")} options={roles} onChange={set("role")} /></Field>
        <Field label={t("usr.f.status")}><Select value={f.status} options={[{ value: "active", label: t("usr.active") }, { value: "inactive", label: t("usr.inactive") }]} onChange={set("status")} /></Field>
        <Field label={t(editing ? "usr.f.passwordEdit" : "usr.f.password")} hint={t("usr.pw.hint")} error={show("password")}><PasswordInput value={f.password} autocomplete="new-password" onInput={set("password")} /></Field>
      </div>
    </Dialog>
  );
}

/** تبويب «قواعد التوصيل». */
export function DeliveryPanel() {
  const list = useQuery((signal) => api.get<RuleRow[]>("/settings/delivery-rules", { signal }), []);
  const act = useAct();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<RuleRow | null>(null);
  const rows = sortRules(arr<RuleRow>(list.data));
  const span = (min: string | null, max: string | null) => {
    const r = rangeParts(min, max);
    if (r.min && r.max) return t("dlv.range", { min: formatNumber(Number(r.min)), max: formatNumber(Number(r.max)) });
    if (r.min) return t("dlv.from", { min: formatNumber(Number(r.min)) });
    if (r.max) return t("dlv.upTo", { max: formatNumber(Number(r.max)) });
    return t("dlv.any");
  };
  const flip = async (r: RuleRow) => {
    const ok = await act.run(async () => { await api.patch<unknown>(`/settings/delivery-rules/${r.id}`, ruleTogglePayload(r)); return true; }, t("dlv.updated"));
    if (ok) await list.refetch();
  };
  const cols: Column<RuleRow>[] = [
    { key: "p", header: t("dlv.col.priority"), cell: (r) => formatNumber(r.priority), numeric: true },
    { key: "l", header: t("dlv.col.label"), cell: (r) => <strong>{r.label}</strong>, mobile: "title" },
    { key: "q", header: t("dlv.col.qty"), cell: (r) => span(r.minQty, r.maxQty) },
    { key: "v", header: t("dlv.col.value"), cell: (r) => span(r.minValue, r.maxValue) },
    { key: "t", header: t("dlv.col.timing"), cell: (r) => t(`dlv.timing.${r.timing}` as CopyKey), mobile: "hide" },
    { key: "m", header: t("dlv.col.method"), cell: (r) => t(`dlv.method.${r.deliveryMethod}` as CopyKey) },
    { key: "s", header: t("dlv.col.state"), cell: (r) => <StatusPill tone={r.isActive ? "success" : "neutral"}>{t(r.isActive ? "dlv.on" : "dlv.off")}</StatusPill> },
    { key: "x", header: t("dlv.col.do"), cell: (r) => (
      <div class="act-toolbar">
        <Button size="sm" variant="ghost" onClick={() => void flip(r)}>{t(r.isActive ? "dlv.turnOff" : "dlv.turnOn")}</Button>
        <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>{t("dlv.delete")}</Button>
      </div>
    ) },
  ];
  return (
    <div class="act-list">
      <p class="st-login__sub">{t("dlv.intro")}</p>
      <div class="act-toolbar"><Button onClick={() => setAdding(true)}>{t("dlv.add")}</Button></div>
      {list.error ? <InlineAlert tone="warn">{t("dlv.loadFail")}</InlineAlert> : null}
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} caption={t("dlv.caption")} loading={list.loading} empty={<EmptyState title={t("dlv.empty")} compact />} />
      {adding ? <RuleDialog onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await list.refetch(); }} /> : null}
      <ConfirmDialog open={!!deleting} danger loading={act.busy} onClose={() => setDeleting(null)} title={t("dlv.confirmDelete")}
        onConfirm={async () => { const r = deleting; if (!r) return; const ok = await act.run(async () => { await api.delete<unknown>(`/settings/delivery-rules/${r.id}`); return true; }, t("dlv.deleted")); if (ok) { setDeleting(null); await list.refetch(); } }} />
    </div>
  );
}

function RuleDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const act = useAct();
  const [f, setF] = useState<RuleForm>(EMPTY_RULE);
  const [tried, setTried] = useState(false);
  const err = ruleError(f);
  const set = (k: keyof RuleForm) => (e: Event) => setF({ ...f, [k]: val(e) } as RuleForm);
  const show = (code: string) => (tried && err === code ? t(`dlv.err.${code}` as CopyKey) : undefined);
  const submit = async () => {
    setTried(true);
    if (err) return;
    const ok = await act.run(async () => { await api.post<unknown>("/settings/delivery-rules", rulePayload(f)); return true; }, t("dlv.created"));
    if (ok) await onDone();
  };
  const num = (k: keyof RuleForm, label: CopyKey) => <Field label={t(label)} error={show("number") && f[k].trim() !== "" ? show("number") : undefined}><Input inputMode="decimal" value={f[k]} onInput={set(k)} /></Field>;
  return (
    <Dialog open onClose={onClose} title={t("dlv.title")} footer={<><Button variant="ghost" onClick={onClose}>{t("dlv.cancel")}</Button><Button loading={act.busy} onClick={() => void submit()}>{t("dlv.save")}</Button></>}>
      <div class="act-list">
        <Field label={t("dlv.f.label")} error={show("label")}><Input value={f.label} maxLength={120} onInput={set("label")} /></Field>
        <p class="st-login__sub">{t("dlv.f.hint")}</p>
        {num("minQty", "dlv.f.minQty")}
        {num("maxQty", "dlv.f.maxQty")}
        {num("minValue", "dlv.f.minValue")}
        {num("maxValue", "dlv.f.maxValue")}
        {tried && err === "range" ? <InlineAlert tone="warn">{t("dlv.err.range")}</InlineAlert> : null}
        <Field label={t("dlv.f.timing")}><Select value={f.timing} options={(["any", "on_time", "late"] as const).map((x) => ({ value: x, label: t(`dlv.timing.${x}` as CopyKey) }))} onChange={set("timing")} /></Field>
        <Field label={t("dlv.f.method")}><Select value={f.deliveryMethod} options={(["customer", "warehouse"] as const).map((x) => ({ value: x, label: t(`dlv.method.${x}` as CopyKey) }))} onChange={set("deliveryMethod")} /></Field>
        <Field label={t("dlv.f.priority")} error={show("priority")}><Input inputMode="numeric" value={f.priority} onInput={set("priority")} /></Field>
      </div>
    </Dialog>
  );
}

/** تبويب «عن النظام»: أرقام عامة + مسح الكاش المحلي. */
export function AboutPanel() {
  const info = useQuery((signal) => api.get<SystemInfo>("/system-info", { signal }), []);
  const act = useAct();
  const i = info.data;
  const clear = async () => {
    let keys: string[] = [];
    try {
      keys = cacheKeys(Object.keys(localStorage));
      keys.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* التخزين المحلي مقفول: مفيش حاجة تتمسح */
    }
    await act.run(async () => true, t("abt.cacheDone", { n: formatNumber(keys.length) }));
  };
  const up = i ? uptimeParts(i.uptimeSeconds) : null;
  return (
    <div class="act-list">
      <p class="st-login__sub">{t("abt.intro")}</p>
      {info.error ? <InlineAlert tone="warn">{t("abt.loadFail")}</InlineAlert> : null}
      {i && up ? (
        <div class="act-toolbar">
          <Stat label={t("abt.version")} value={i.version} />
          <Stat label={t("abt.uptime")} value={t("abt.uptimeValue", { d: formatNumber(up.days), h: formatNumber(up.hours), m: formatNumber(up.minutes) })} />
          <Stat label={t("abt.dbSize")} value={i.databaseSize} />
          <Stat label={t("abt.today")} value={formatNumber(i.todayActivity)} tone="brand" />
          <Stat label={t("abt.contacts")} value={formatNumber(i.modules.contacts)} />
          <Stat label={t("abt.sales")} value={formatNumber(i.modules.sales)} />
          <Stat label={t("abt.inventory")} value={formatNumber(i.modules.inventory)} />
          <Stat label={t("abt.users")} value={formatNumber(i.modules.users)} />
        </div>
      ) : null}
      <Field label={t("abt.cache")} hint={t("abt.cacheHint")}><div><Button variant="ghost" loading={act.busy} onClick={() => void clear()}>{t("abt.cacheDo")}</Button></div></Field>
    </div>
  );
}
