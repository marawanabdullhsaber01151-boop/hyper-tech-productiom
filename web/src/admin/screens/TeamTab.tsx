import { useMemo, useState } from "preact/hooks";
import { t } from "../../copy";
import { Avatar, Button, ConfirmDialog, CopyField, DataTable, Dialog, EmptyState, Field, Input, Menu, PermissionMatrix, Select, ShareLinkCard, type Column, type PermGroup } from "../../design/components";
import { Ban, Ellipsis, KeyRound, Lock, Pencil, Play, Plus, Trash, UserPlus } from "../../design/icons";
import { useQuery } from "../../api/hooks";
import { formatRelative } from "../../lib/format";
import { api } from "../api";
import { useAct } from "../act";
import { memberStatusLabel, memberStatusTone } from "../parts";
import { StatusPill } from "../../design/components";
import type { CompanyDetail, Member, Override, PermCatalog } from "../types";

interface Props {
  d: CompanyDetail;
  reload: () => Promise<void>;
}

const LIMIT_KEYS = ["maxQtyPerLine", "maxLinesPerOrder", "maxOrdersPerDay", "maxOrderValue"] as const;

function AddMember({ d, open, onClose, reload }: Props & { open: boolean; onClose: () => void }) {
  const { run, busy } = useAct();
  const [f, setF] = useState({ fullName: "", phone: "", email: "", roleKey: "", title: "" });
  const [done, setDone] = useState<{ tempPassword: string; whatsappUrl: string | null; message: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const roleKey = f.roleKey || d.roles.find((r) => r.key === "buyer")?.key || d.roles[0]?.key || "";
  const close = () => {
    setDone(null);
    setErr(null);
    setF({ fullName: "", phone: "", email: "", roleKey: "", title: "" });
    onClose();
  };
  const submit = async () => {
    setErr(null);
    if (f.fullName.trim().length < 2 || f.phone.trim().length < 8) return setErr(t("a.team.add.required"));
    try {
      const r = await api.post<{ tempPassword: string; whatsappUrl: string | null; message: string }>(`/portal-companies/${d.company.id}/members`, { fullName: f.fullName, phone: f.phone, email: f.email || null, roleKey, title: f.title || null });
      setDone(r);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={done ? t("a.team.add.doneTitle") : t("a.team.add.title")}
      description={done ? t("a.team.add.doneBody") : t("a.team.add.sub")}
      footer={done ? <Button onClick={close}>{t("common.done")}</Button> : <><Button variant="ghost" onClick={close}>{t("common.cancel")}</Button><Button loading={busy} onClick={() => void run(submit)}>{t("a.team.add.submit")}</Button></>}
    >
      {done ? (
        <div class="ad-stack">
          <CopyField label={t("a.team.add.tempPass")} value={done.tempPassword} />
          <CopyField label={t("a.team.add.message")} value={done.message} mono={false} ltr={false} />
          {done.whatsappUrl ? (
            <Button variant="secondary" onClick={() => window.open(done.whatsappUrl!, "_blank", "noopener")}>{t("a.team.add.whatsapp")}</Button>
          ) : null}
          <p class="ad-muted">{t("a.team.add.once")}</p>
        </div>
      ) : (
        <form class="ad-stack" onSubmit={(e) => { e.preventDefault(); void run(submit); }}>
          <Field label={t("a.team.f.name")} required><Input value={f.fullName} onInput={(e) => setF({ ...f, fullName: (e.currentTarget as HTMLInputElement).value })} /></Field>
          <Field label={t("a.team.f.phone")} required><Input dir="ltr" inputMode="tel" value={f.phone} onInput={(e) => setF({ ...f, phone: (e.currentTarget as HTMLInputElement).value })} /></Field>
          <Field label={t("a.team.f.role")}>
            <Select value={roleKey} options={d.roles.map((r) => ({ value: r.key, label: r.name }))} onChange={(e) => setF({ ...f, roleKey: (e.currentTarget as HTMLSelectElement).value })} />
          </Field>
          <Field label={t("a.team.f.email")} optional><Input dir="ltr" type="email" value={f.email} onInput={(e) => setF({ ...f, email: (e.currentTarget as HTMLInputElement).value })} /></Field>
          <Field label={t("a.team.f.title")} optional><Input value={f.title} onInput={(e) => setF({ ...f, title: (e.currentTarget as HTMLInputElement).value })} /></Field>
          {err ? <p class="ad-error" role="alert">{err}</p> : null}
        </form>
      )}
    </Dialog>
  );
}

function EditMember({ d, m, onClose, reload }: Props & { m: Member | null; onClose: () => void }) {
  const { run, busy } = useAct();
  const catalog = useQuery((signal) => api.get<PermCatalog>("/portal-companies/permissions", { signal }), []);
  const [roleKey, setRoleKey] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [limits, setLimits] = useState<Record<string, string> | null>(null);
  const [perms, setPerms] = useState<Set<string> | null>(null);
  if (!m) return null;

  const role = roleKey ?? m.roleKey;
  const base = new Set(d.roles.find((r) => r.key === role)?.permissions ?? []);
  const effective = (() => {
    if (perms) return perms;
    const s = new Set(d.roles.find((r) => r.key === m.roleKey)?.permissions ?? []);
    for (const o of m.overrides) (o.effect === "allow" ? s.add(o.permissionKey) : s.delete(o.permissionKey));
    return s;
  })();
  const groups: PermGroup[] = (catalog.data?.groups ?? []).map((g) => ({
    id: g.key,
    label: g.label,
    items: (catalog.data?.permissions ?? []).filter((p) => p.group === g.key).map((p) => ({ key: p.key, label: p.label, hint: p.description })),
  }));
  const lim = limits ?? Object.fromEntries(LIMIT_KEYS.map((k) => [k, m.limits[k] ? String(m.limits[k]) : ""]));
  const close = () => {
    setRoleKey(null);
    setTitle(null);
    setLimits(null);
    setPerms(null);
    onClose();
  };
  const save = async () => {
    const overrides: Override[] = [];
    for (const p of catalog.data?.permissions ?? []) {
      const has = effective.has(p.key);
      const inBase = base.has(p.key);
      if (has && !inBase) overrides.push({ permissionKey: p.key, effect: "allow" });
      if (!has && inBase) overrides.push({ permissionKey: p.key, effect: "deny" });
    }
    const limitsOut: Record<string, number> = {};
    for (const k of LIMIT_KEYS) if (Number(lim[k]) > 0) limitsOut[k] = Number(lim[k]);
    const ok = await run(() => api.patch(`/portal-companies/${d.company.id}/members/${m.memberId}`, { roleKey: role, title: (title ?? m.title ?? "") || null, limits: limitsOut, ...(catalog.data ? { overrides } : {}) }), t("common.saved"));
    if (ok !== undefined) {
      await reload();
      close();
    }
  };
  return (
    <Dialog open onClose={close} title={t("a.team.edit.title", { name: m.fullName })} size="lg" footer={<><Button variant="ghost" onClick={close}>{t("common.cancel")}</Button><Button loading={busy} onClick={() => void save()}>{t("common.save")}</Button></>}>
      <div class="ad-stack">
        <Field label={t("a.team.f.role")}>
          <Select value={role} options={d.roles.map((r) => ({ value: r.key, label: r.name }))} onChange={(e) => { setRoleKey((e.currentTarget as HTMLSelectElement).value); setPerms(new Set(d.roles.find((r) => r.key === (e.currentTarget as HTMLSelectElement).value)?.permissions ?? [])); }} />
        </Field>
        <Field label={t("a.team.f.title")} optional><Input value={title ?? m.title ?? ""} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} /></Field>
        <fieldset class="ad-fieldset">
          <legend>{t("a.team.limits")}</legend>
          <p class="ad-muted">{t("a.team.limits.hint")}</p>
          <div class="ad-grid2">
            {LIMIT_KEYS.map((k) => (
              <Field key={k} label={t(`a.team.limit.${k}` as never)} optional>
                <Input type="number" min={1} inputMode="numeric" value={lim[k] ?? ""} onInput={(e) => setLimits({ ...lim, [k]: (e.currentTarget as HTMLInputElement).value })} />
              </Field>
            ))}
          </div>
        </fieldset>
        <fieldset class="ad-fieldset">
          <legend>{t("a.team.perms")}</legend>
          {catalog.data ? <PermissionMatrix groups={groups} value={effective} onChange={(n) => setPerms(n)} /> : <p class="ad-muted">{t("common.loading")}</p>}
        </fieldset>
      </div>
    </Dialog>
  );
}

type Confirm = { kind: "suspend" | "remove" | "revoke"; m: Member } | null;

export function TeamTab({ d, reload }: Props) {
  const { run, busy } = useAct();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [link, setLink] = useState<{ m: Member; url: string } | null>(null);
  const id = d.company.id;

  const doConfirm = async () => {
    if (!confirm) return;
    const { kind, m } = confirm;
    const path = kind === "suspend" ? "suspend" : kind === "remove" ? "remove" : "revoke-sessions";
    const ok = await run(() => api.post(`/portal-companies/${id}/members/${m.memberId}/${path}`, {}), t("a.done"));
    if (ok !== undefined) {
      setConfirm(null);
      await reload();
    }
  };
  const reactivate = async (m: Member) => {
    const ok = await run(() => api.post(`/portal-companies/${id}/members/${m.memberId}/reactivate`, {}), t("a.done"));
    if (ok !== undefined) await reload();
  };
  const resetLink = async (m: Member) => {
    const r = await run(() => api.post<{ url: string }>(`/portal-companies/${id}/members/${m.memberId}/reset-link`, {}));
    if (r) setLink({ m, url: r.url });
  };

  const columns: Column<Member>[] = useMemo(
    () => [
      { key: "name", header: t("a.team.col.name"), mobile: "title", cell: (m) => (
        <div class="ad-person">
          <Avatar name={m.fullName} size={36} />
          <div>
            <strong>{m.fullName}</strong>
            <div class="ad-muted"><bdi dir="ltr">{m.phone}</bdi>{m.title ? ` · ${m.title}` : ""}</div>
          </div>
        </div>
      ) },
      { key: "role", header: t("a.team.col.role"), cell: (m) => (m.isOwner ? t("a.team.owner") : m.roleName) },
      { key: "status", header: t("a.team.col.status"), cell: (m) => <StatusPill tone={memberStatusTone(m.status)}>{memberStatusLabel(m.status)}</StatusPill> },
      { key: "last", header: t("a.team.col.last"), cell: (m) => (m.lastActiveAt ? formatRelative(m.lastActiveAt) : t("a.never")) },
    ],
    [],
  );

  const actions = (m: Member) =>
    m.isOwner ? null : (
      <Menu
        label={t("common.actions")}
        trigger={({ toggle, open, id: tid }) => (
          <Button variant="ghost" size="sm" icon={Ellipsis} aria-expanded={open} aria-controls={tid} onClick={toggle} aria-label={t("common.actions")} />
        )}
        items={[
          { label: t("a.team.act.edit"), icon: Pencil, onSelect: () => setEditing(m) },
          m.status === "suspended"
            ? { label: t("a.team.act.reactivate"), icon: Play, onSelect: () => void reactivate(m) }
            : { label: t("a.team.act.suspend"), icon: Ban, onSelect: () => setConfirm({ kind: "suspend", m }), disabled: m.status !== "active" },
          { label: t("a.team.act.reset"), icon: KeyRound, onSelect: () => void resetLink(m) },
          { label: t("a.team.act.revoke"), icon: Lock, onSelect: () => setConfirm({ kind: "revoke", m }) },
          { label: t("a.team.act.remove"), icon: Trash, danger: true, onSelect: () => setConfirm({ kind: "remove", m }) },
        ]}
      />
    );

  return (
    <div class="ad-stack">
      <div class="ad-row ad-row--between">
        <p class="ad-muted">{t("a.team.count", { n: d.members.length })}</p>
        <Button icon={UserPlus} onClick={() => setAdding(true)}>{t("a.team.add")}</Button>
      </div>
      <DataTable
        columns={columns}
        rows={d.members}
        rowKey={(m) => m.memberId}
        caption={t("a.team.caption")}
        rowActions={actions}
        empty={<EmptyState title={t("a.team.empty")} action={<Button icon={Plus} onClick={() => setAdding(true)}>{t("a.team.add")}</Button>} />}
      />
      <AddMember d={d} reload={reload} open={adding} onClose={() => setAdding(false)} />
      <EditMember d={d} reload={reload} m={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={doConfirm}
        loading={busy}
        danger={confirm?.kind !== "revoke"}
        title={confirm ? t(`a.team.confirm.${confirm.kind}.title` as never, { name: confirm.m.fullName }) : ""}
        description={confirm ? t(`a.team.confirm.${confirm.kind}.body` as never) : undefined}
        confirmLabel={confirm ? t(`a.team.confirm.${confirm.kind}.ok` as never) : undefined}
      />
      <Dialog open={!!link} onClose={() => setLink(null)} title={t("a.team.link.title", { name: link?.m.fullName ?? "" })} description={t("a.team.link.body")} footer={<Button onClick={() => setLink(null)}>{t("common.done")}</Button>}>
        {link ? <ShareLinkCard url={link.url} title={t("a.team.link.card")} whatsappPhone={link.m.phone} whatsappText={t("a.team.link.wa", { url: link.url })} /> : null}
      </Dialog>
    </div>
  );
}
