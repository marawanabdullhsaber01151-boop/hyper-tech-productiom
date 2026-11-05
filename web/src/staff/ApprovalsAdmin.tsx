import "../copy/approvalsAdmin";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Checkbox, ConfirmDialog, DataTable, Dialog, EmptyState, Field, InlineAlert, Input, Select, Stat, StatusPill, type Column, type Option } from "../design/components";
import { formatDateTime, formatNumber } from "../lib/format";
import {
  EMPTY_DELEGATION, EMPTY_OVERRIDE, EMPTY_POLICY, canRevoke, countActive, delegationError, delegationPayload, delegationState, overrideError, overridePayload, overrideState, policyError, policyPayload, simulateSummary, sortPolicies, togglePayload,
  type DelegationForm, type DelegationRow, type DelegationState, type OverrideForm, type OverrideRow, type PolicyForm, type PolicyRow, type SimRow, type VerifyResult,
} from "./approvalsAdminCore";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const tone = (s: DelegationState | "active" | "expired" | "revoked"): "success" | "neutral" | "warn" => (s === "active" ? "success" : s === "upcoming" ? "warn" : "neutral");

interface GovUser { id: number; fullName: string; role: string; roleLabel: string; status: string }
interface GovAction { key: string; label: string; group: string }
const userOptions = (users: readonly GovUser[]): Option[] => users.map((u) => ({ value: String(u.id), label: `${u.fullName} — ${u.roleLabel}` }));
const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const SCOPES = ["company", "factory", "branch", "warehouse", "department", "production_line", "document"];

/** تبويب «النواب»: تفويض إجراء لموظف لفترة، وإلغاؤه. */
export function DelegationsPanel() {
  const list = useQuery((signal) => api.get<DelegationRow[]>("/governance/delegations", { signal }), []);
  const users = useQuery((signal) => api.get<GovUser[]>("/governance/users", { signal }), []);
  const actions = useQuery((signal) => api.get<GovAction[]>("/governance/actions", { signal }), []);
  const act = useAct();
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<DelegationRow | null>(null);
  const rows = arr<DelegationRow>(list.data);
  const actionLabel = (k: string) => arr<GovAction>(actions.data).find((a) => a.key === k)?.label ?? k;

  const cols: Column<DelegationRow>[] = [
    { key: "a", header: t("apa.del.col.action"), cell: (r) => <strong>{actionLabel(r.delegation.actionKey)}</strong>, mobile: "title" },
    { key: "g", header: t("apa.del.col.grantor"), cell: (r) => r.grantorName },
    { key: "d", header: t("apa.del.col.delegate"), cell: (r) => r.delegateName ?? "—" },
    { key: "f", header: t("apa.del.col.from"), cell: (r) => formatDateTime(r.delegation.startsAt), mobile: "hide" },
    { key: "e", header: t("apa.del.col.to"), cell: (r) => formatDateTime(r.delegation.endsAt), mobile: "hide" },
    { key: "s", header: t("apa.del.col.state"), cell: (r) => { const s = delegationState(r.delegation); return <StatusPill tone={tone(s)}>{t(`apa.state.${s}` as CopyKey)}</StatusPill>; } },
    { key: "x", header: t("apa.del.col.do"), cell: (r) => (canRevoke(delegationState(r.delegation)) ? <Button size="sm" variant="ghost" onClick={() => setRevoking(r)}>{t("apa.del.revoke")}</Button> : "—") },
  ];
  return (
    <div>
      <p class="st-login__sub">{t("apa.del.intro")}</p>
      <div class="act-toolbar">
        <Stat label={t("apa.del.stat.active")} value={formatNumber(countActive(rows))} tone="brand" />
        <Button onClick={() => setAdding(true)}>{t("apa.del.add")}</Button>
      </div>
      {list.error ? <InlineAlert tone="warn">{t("apa.loadFail")}</InlineAlert> : null}
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.delegation.id} caption={t("apa.del.caption")} loading={list.loading} empty={<EmptyState title={t("apa.del.empty")} compact />} />
      {adding ? <DelegationDialog users={arr<GovUser>(users.data)} actions={arr<GovAction>(actions.data)} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await list.refetch(); }} /> : null}
      <ConfirmDialog open={!!revoking} danger loading={act.busy} onClose={() => setRevoking(null)} title={t("apa.del.confirmRevoke")}
        onConfirm={async () => { const r = revoking; if (!r) return; const ok = await act.run(async () => { await api.patch<unknown>(`/governance/delegations/${r.delegation.id}/revoke`, {}); return true; }, t("apa.del.revoked")); if (ok) { setRevoking(null); await list.refetch(); } }} />
    </div>
  );
}

function DelegationDialog({ users, actions, onClose, onDone }: { users: GovUser[]; actions: GovAction[]; onClose: () => void; onDone: () => Promise<void> }) {
  const act = useAct();
  const [f, setF] = useState<DelegationForm>(EMPTY_DELEGATION);
  const [tried, setTried] = useState(false);
  const err = delegationError(f);
  const set = (k: keyof DelegationForm) => (e: Event) => setF({ ...f, [k]: val(e) });
  const submit = async () => {
    setTried(true);
    if (err) return;
    const ok = await act.run(async () => { await api.post<unknown>("/governance/delegations", delegationPayload(f)); return true; }, t("apa.del.created"));
    if (ok) await onDone();
  };
  const show = (...codes: string[]) => (tried && err && codes.includes(err) ? t(`apa.err.${err}` as CopyKey) : undefined);
  return (
    <Dialog open onClose={onClose} title={t("apa.del.title")} footer={<><Button variant="ghost" onClick={onClose}>{t("apa.cancel")}</Button><Button loading={act.busy} onClick={() => void submit()}>{t("apa.save")}</Button></>}>
      <div class="act-list">
        <Field label={t("apa.del.grantor")} error={show("grantor")}><Select value={f.grantorUserId} placeholder={t("apa.del.pick")} options={userOptions(users)} onChange={set("grantorUserId")} /></Field>
        <Field label={t("apa.del.delegate")} error={show("delegate", "same")}><Select value={f.delegateUserId} placeholder={t("apa.del.pick")} options={userOptions(users)} onChange={set("delegateUserId")} /></Field>
        <Field label={t("apa.del.action")} error={show("action")}><Select value={f.actionKey} placeholder={t("apa.del.pick")} options={actions.map((a) => ({ value: a.key, label: `${a.group} — ${a.label}` }))} onChange={set("actionKey")} /></Field>
        <Field label={t("apa.del.scope")}><Select value={f.scopeType} options={SCOPES.map((s) => ({ value: s, label: t(`apa.scope.${s}` as CopyKey) }))} onChange={set("scopeType")} /></Field>
        <Field label={t("apa.del.starts")} error={show("dates")}><Input type="datetime-local" value={f.startsAt} onInput={set("startsAt")} /></Field>
        <Field label={t("apa.del.ends")} error={show("range", "past")}><Input type="datetime-local" value={f.endsAt} onInput={set("endsAt")} /></Field>
        <Field label={t("apa.del.reason")} error={show("reason")}><Input value={f.reason} maxLength={500} onInput={set("reason")} /></Field>
      </div>
    </Dialog>
  );
}

/** تبويب «سياسات الاعتماد»: مين يعتمد حسب المبلغ والخطوة. التعديل لرئيس المجلس فقط. */
export function PoliciesPanel({ canEdit }: { canEdit: boolean }) {
  const list = useQuery((signal) => api.get<PolicyRow[]>("/governance/approval-policies", { signal }), []);
  const roles = useQuery((signal) => api.get<Option[]>("/governance/roles", { signal }), []);
  const actions = useQuery((signal) => api.get<GovAction[]>("/governance/actions", { signal }), []);
  const act = useAct();
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<PolicyRow | null>(null);
  const rows = sortPolicies(arr<PolicyRow>(list.data));
  const roleLabel = (r: string) => arr<Option>(roles.data).find((o) => o.value === r)?.label ?? r;
  const actionLabel = (k: string) => arr<GovAction>(actions.data).find((a) => a.key === k)?.label ?? k;
  const flip = async (p: PolicyRow) => {
    const ok = await act.run(async () => { await api.patch<unknown>(`/governance/approval-policies/${p.id}`, togglePayload(p)); return true; }, t("apa.pol.updated"));
    if (ok) { setToggling(null); await list.refetch(); }
  };
  const cols: Column<PolicyRow>[] = [
    { key: "a", header: t("apa.pol.col.action"), cell: (p) => <strong>{actionLabel(p.actionKey)}</strong>, mobile: "title" },
    { key: "m", header: t("apa.pol.col.min"), cell: (p) => formatNumber(Number(p.minAmount)), numeric: true },
    { key: "r", header: t("apa.pol.col.roles"), cell: (p) => p.approverRoles.map(roleLabel).join(t("apa.pol.sep")) },
    { key: "q", header: t("apa.pol.col.seq"), cell: (p) => formatNumber(p.sequence), numeric: true, mobile: "hide" },
    { key: "s", header: t("apa.pol.col.state"), cell: (p) => <StatusPill tone={p.active ? "success" : "neutral"}>{t(p.active ? "apa.pol.on" : "apa.pol.off")}</StatusPill> },
    ...(canEdit ? [{ key: "x", header: t("apa.del.col.do"), cell: (p: PolicyRow) => <Button size="sm" variant="ghost" onClick={() => (p.active ? setToggling(p) : void flip(p))}>{t(p.active ? "apa.pol.turnOff" : "apa.pol.turnOn")}</Button> }] : []),
  ];
  return (
    <div>
      <p class="st-login__sub">{t("apa.pol.intro")}</p>
      {canEdit ? <div class="act-toolbar"><Button onClick={() => setAdding(true)}>{t("apa.pol.add")}</Button></div> : <InlineAlert tone="info">{t("apa.pol.readonly")}</InlineAlert>}
      {list.error ? <InlineAlert tone="warn">{t("apa.loadFail")}</InlineAlert> : null}
      <DataTable columns={cols} rows={rows} rowKey={(p) => p.id} caption={t("apa.pol.caption")} loading={list.loading} empty={<EmptyState title={t("apa.pol.empty")} compact />} />
      {adding ? <PolicyDialog roles={arr<Option>(roles.data)} actions={arr<GovAction>(actions.data)} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await list.refetch(); }} /> : null}
      <ConfirmDialog open={!!toggling} danger loading={act.busy} onClose={() => setToggling(null)} title={t("apa.pol.confirmOff")} onConfirm={async () => { if (toggling) await flip(toggling); }} />
    </div>
  );
}

function PolicyDialog({ roles, actions, onClose, onDone }: { roles: Option[]; actions: GovAction[]; onClose: () => void; onDone: () => Promise<void> }) {
  const act = useAct();
  const [f, setF] = useState<PolicyForm>(EMPTY_POLICY);
  const [tried, setTried] = useState(false);
  const err = policyError(f);
  const submit = async () => {
    setTried(true);
    if (err) return;
    const ok = await act.run(async () => { await api.post<unknown>("/governance/approval-policies", policyPayload(f)); return true; }, t("apa.pol.created"));
    if (ok) await onDone();
  };
  const show = (code: string) => (tried && err === code ? t(`apa.err.${code}` as CopyKey) : undefined);
  const toggleRole = (r: string) => setF({ ...f, approverRoles: f.approverRoles.includes(r) ? f.approverRoles.filter((x) => x !== r) : [...f.approverRoles, r] });
  return (
    <Dialog open onClose={onClose} title={t("apa.pol.title")} footer={<><Button variant="ghost" onClick={onClose}>{t("apa.cancel")}</Button><Button loading={act.busy} onClick={() => void submit()}>{t("apa.save")}</Button></>}>
      <div class="act-list">
        <Field label={t("apa.del.action")} error={show("action")}><Select value={f.actionKey} placeholder={t("apa.del.pick")} options={actions.map((a) => ({ value: a.key, label: `${a.group} — ${a.label}` }))} onChange={(e) => setF({ ...f, actionKey: val(e) })} /></Field>
        <Field label={t("apa.pol.min")} error={show("amount")}><Input inputMode="decimal" value={f.minAmount} onInput={(e) => setF({ ...f, minAmount: val(e) })} /></Field>
        <Field label={t("apa.pol.roles")} hint={t("apa.pol.rolesHint")} error={show("roles")}>
          <div class="act-list">{roles.map((r) => <Checkbox key={r.value} label={r.label} checked={f.approverRoles.includes(r.value)} onChange={() => toggleRole(r.value)} />)}</div>
        </Field>
        <Field label={t("apa.pol.seq")} error={show("sequence")}><Input inputMode="numeric" value={f.sequence} onInput={(e) => setF({ ...f, sequence: val(e) })} /></Field>
      </div>
    </Dialog>
  );
}

/** تبويب «الصلاحيات»: استثناءات لكل موظف + محاكاة النتيجة الفعلية. رئيس المجلس فقط. */
export function PermissionsPanel() {
  const users = useQuery((signal) => api.get<GovUser[]>("/governance/users", { signal }), []);
  const actions = useQuery((signal) => api.get<GovAction[]>("/governance/actions", { signal }), []);
  const roles = useQuery((signal) => api.get<Option[]>("/governance/roles", { signal }), []);
  const [userId, setUserId] = useState("");
  const list = useQuery((signal) => (userId ? api.get<OverrideRow[]>(`/users/${userId}/permission-overrides`, { signal }) : Promise.resolve([] as OverrideRow[])), [userId]);
  const act = useAct();
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<OverrideRow | null>(null);
  const rows = arr<OverrideRow>(list.data);
  const actionLabel = (k: string) => arr<GovAction>(actions.data).find((a) => a.key === k)?.label ?? k;

  const cols: Column<OverrideRow>[] = [
    { key: "a", header: t("apa.perm.col.action"), cell: (o) => <strong>{actionLabel(o.actionKey)}</strong>, mobile: "title" },
    { key: "m", header: t("apa.perm.col.mode"), cell: (o) => <StatusPill tone={o.allowed ? "success" : "danger"}>{t(o.allowed ? "apa.perm.allowed" : "apa.perm.denied")}</StatusPill> },
    { key: "r", header: t("apa.perm.col.reason"), cell: (o) => o.reason ?? "—", mobile: "hide" },
    { key: "u", header: t("apa.perm.col.until"), cell: (o) => (o.expiresAt ? formatDateTime(o.expiresAt) : t("apa.perm.forever")), mobile: "hide" },
    { key: "s", header: t("apa.perm.col.state"), cell: (o) => { const s = overrideState(o); return <StatusPill tone={tone(s)}>{t(`apa.state.${s}` as CopyKey)}</StatusPill>; } },
    { key: "x", header: t("apa.perm.col.do"), cell: (o) => (overrideState(o) === "active" ? <Button size="sm" variant="ghost" onClick={() => setRevoking(o)}>{t("apa.perm.revoke")}</Button> : "—") },
  ];
  return (
    <div>
      <p class="st-login__sub">{t("apa.perm.intro")}</p>
      <div class="act-toolbar">
        <Field label={t("apa.perm.user")}><Select value={userId} placeholder={t("apa.del.pick")} options={userOptions(arr<GovUser>(users.data))} onChange={(e) => setUserId(val(e))} /></Field>
        <Button disabled={!userId} onClick={() => setAdding(true)}>{t("apa.perm.add")}</Button>
      </div>
      {!userId ? <InlineAlert tone="info">{t("apa.perm.pickUser")}</InlineAlert> : (
        <DataTable columns={cols} rows={rows} rowKey={(o) => o.id} caption={t("apa.perm.caption")} loading={list.loading} empty={<EmptyState title={t("apa.perm.empty")} compact />} />
      )}
      {adding ? <OverrideDialog userId={userId} actions={arr<GovAction>(actions.data)} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await list.refetch(); }} /> : null}
      <ConfirmDialog open={!!revoking} danger loading={act.busy} onClose={() => setRevoking(null)} title={t("apa.perm.confirmRevoke")}
        onConfirm={async () => { const o = revoking; if (!o) return; const ok = await act.run(async () => { await api.delete<unknown>(`/permission-overrides/${o.id}`); return true; }, t("apa.perm.revoked")); if (ok) { setRevoking(null); await list.refetch(); } }} />
      <Simulator users={arr<GovUser>(users.data)} roles={arr<Option>(roles.data)} />
    </div>
  );
}

function OverrideDialog({ userId, actions, onClose, onDone }: { userId: string; actions: GovAction[]; onClose: () => void; onDone: () => Promise<void> }) {
  const act = useAct();
  const [f, setF] = useState<OverrideForm>({ ...EMPTY_OVERRIDE, userId });
  const [tried, setTried] = useState(false);
  const err = overrideError(f);
  const submit = async () => {
    setTried(true);
    if (err) return;
    const ok = await act.run(async () => { await api.post<unknown>("/permission-overrides", overridePayload(f)); return true; }, t("apa.perm.created"));
    if (ok) await onDone();
  };
  const show = (code: string) => (tried && err === code ? t(`apa.err.${code}` as CopyKey) : undefined);
  return (
    <Dialog open onClose={onClose} title={t("apa.perm.title")} footer={<><Button variant="ghost" onClick={onClose}>{t("apa.cancel")}</Button><Button loading={act.busy} onClick={() => void submit()}>{t("apa.save")}</Button></>}>
      <div class="act-list">
        <Field label={t("apa.del.action")} error={show("action")}><Select value={f.actionKey} placeholder={t("apa.del.pick")} options={actions.map((a) => ({ value: a.key, label: `${a.group} — ${a.label}` }))} onChange={(e) => setF({ ...f, actionKey: val(e) })} /></Field>
        <Field label={t("apa.perm.mode")}><Select value={f.allowed} options={[{ value: "true", label: t("apa.perm.grant") }, { value: "false", label: t("apa.perm.deny") }]} onChange={(e) => setF({ ...f, allowed: val(e) as "true" | "false" })} /></Field>
        <Field label={t("apa.perm.expires")} error={show("expiry")}><Input type="datetime-local" value={f.expiresAt} onInput={(e) => setF({ ...f, expiresAt: val(e) })} /></Field>
        <Field label={t("apa.del.reason")} error={show("reason")}><Input value={f.reason} maxLength={500} onInput={(e) => setF({ ...f, reason: val(e) })} /></Field>
      </div>
    </Dialog>
  );
}

function Simulator({ users, roles }: { users: GovUser[]; roles: Option[] }) {
  const act = useAct();
  const [uid, setUid] = useState("");
  const [role, setRole] = useState("");
  const [res, setRes] = useState<SimRow[] | null>(null);
  const [need, setNeed] = useState(false);
  const run = async () => {
    if (!uid && !role) { setNeed(true); return; }
    setNeed(false);
    const q = new URLSearchParams();
    if (uid) q.set("userId", uid);
    if (role) q.set("role", role);
    const r = await act.run(() => api.get<SimRow[]>(`/governance/simulate?${q}`));
    if (r) setRes(arr<SimRow>(r));
  };
  const sum = res ? simulateSummary(res) : null;
  const cols: Column<SimRow>[] = [
    { key: "a", header: t("apa.sim.col.action"), cell: (r) => r.label, mobile: "title" },
    { key: "r", header: t("apa.sim.col.result"), cell: (r) => <StatusPill tone={r.allowed ? "success" : "neutral"}>{t(r.allowed ? "apa.perm.allowed" : "apa.perm.denied")}</StatusPill> },
  ];
  return (
    <section>
      <h2 class="act-day">{t("apa.sim.title")}</h2>
      <p class="st-login__sub">{t("apa.sim.hint")}</p>
      <div class="act-toolbar">
        <Field label={t("apa.perm.user")}><Select value={uid} placeholder={t("apa.sim.none")} options={userOptions(users)} onChange={(e) => setUid(val(e))} /></Field>
        <Field label={t("apa.sim.role")}><Select value={role} placeholder={t("apa.sim.none")} options={roles} onChange={(e) => setRole(val(e))} /></Field>
        <Button loading={act.busy} onClick={() => void run()}>{t("apa.sim.run")}</Button>
      </div>
      {need ? <InlineAlert tone="warn">{t("apa.sim.need")}</InlineAlert> : null}
      {sum ? <InlineAlert tone="info">{t("apa.sim.result", { allowed: formatNumber(sum.allowed), total: formatNumber(sum.total) })}</InlineAlert> : null}
      {res ? <DataTable columns={cols} rows={res} rowKey={(r) => r.key} caption={t("apa.sim.title")} empty={<EmptyState title={t("apa.perm.empty")} compact />} /> : null}
    </section>
  );
}

interface SessionRow { id: number; lastActiveAt: string; userAgent: string | null; isCurrent: boolean }

/** تبويب «الأمان»: فحص سلامة سجل التدقيق (رئيس المجلس) + جلساتي (لكل واحد). */
export function SecurityPanel({ canVerify }: { canVerify: boolean }) {
  const sessions = useQuery((signal) => api.get<SessionRow[]>("/auth/sessions", { signal }), []);
  const act = useAct();
  const [verdict, setVerdict] = useState<VerifyResult | null>(null);
  const [closing, setClosing] = useState<SessionRow | null>(null);
  const rows = arr<SessionRow>(sessions.data);
  const verify = async () => { const r = await act.run(() => api.get<VerifyResult>("/governance/audit-events/verify")); if (r) setVerdict(r); };
  const cols: Column<SessionRow>[] = [
    { key: "l", header: t("apa.sec.col.last"), cell: (s) => formatDateTime(s.lastActiveAt), mobile: "title" },
    { key: "d", header: t("apa.sec.col.device"), cell: (s) => s.userAgent || t("apa.sec.unknownDevice"), mobile: "hide" },
    { key: "s", header: t("apa.sec.col.state"), cell: (s) => <StatusPill tone={s.isCurrent ? "success" : "neutral"}>{t(s.isCurrent ? "apa.sec.current" : "apa.sec.other")}</StatusPill> },
    { key: "x", header: t("apa.sec.col.do"), cell: (s) => (s.isCurrent ? "—" : <Button size="sm" variant="ghost" onClick={() => setClosing(s)}>{t("apa.sec.close")}</Button>) },
  ];
  return (
    <div>
      {canVerify ? (
        <section>
          <h2 class="act-day">{t("apa.sec.verify.title")}</h2>
          <p class="st-login__sub">{t("apa.sec.verify.hint")}</p>
          <div class="act-toolbar"><Button loading={act.busy} onClick={() => void verify()}>{t("apa.sec.verify.run")}</Button></div>
          {verdict ? <InlineAlert tone={verdict.valid ? "info" : "warn"}>{verdict.valid ? t("apa.sec.verify.ok", { count: formatNumber(verdict.count ?? 0) }) : t("apa.sec.verify.bad", { id: formatNumber(verdict.firstInvalidId ?? 0) })}</InlineAlert> : null}
        </section>
      ) : null}
      <section>
        <h2 class="act-day">{t("apa.sec.sessions.title")}</h2>
        <p class="st-login__sub">{t("apa.sec.sessions.hint")}</p>
        {sessions.error ? <InlineAlert tone="warn">{t("apa.loadFail")}</InlineAlert> : null}
        <DataTable columns={cols} rows={rows} rowKey={(s) => s.id} caption={t("apa.sec.caption")} loading={sessions.loading} empty={<EmptyState title={t("apa.sec.empty")} compact />} />
      </section>
      <ConfirmDialog open={!!closing} danger loading={act.busy} onClose={() => setClosing(null)} title={t("apa.sec.confirmClose")}
        onConfirm={async () => { const s = closing; if (!s) return; const ok = await act.run(async () => { await api.delete<unknown>(`/auth/sessions/${s.id}`); return true; }, t("apa.sec.closed")); if (ok) { setClosing(null); await sessions.refetch(); } }} />
    </div>
  );
}
