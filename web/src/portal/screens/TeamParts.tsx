import { useEffect, useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Button, Dialog, Field, InlineAlert, Input, Select, StatusPill, useToast } from "../../design/components";
import { useMutation, useQuery } from "../../api/hooks";
import { copyText } from "../../lib/clipboard";
import { formatRelative } from "../../lib/format";
import { api } from "../api";
import type { AuditEvent, TeamRole } from "../types";
import { ListSkeleton, LoadError } from "./shared";
import { EmptyState } from "../../design/components";

interface Added {
  memberId: number;
  tempPassword: string;
  whatsappUrl: string;
  message: string;
}

export function AddMemberDialog({ open, onClose, roles, onDone }: { open: boolean; onClose: () => void; roles: TeamRole[]; onDone: () => void }) {
  const toast = useToast();
  const [fullName, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [roleKey, setRole] = useState("");
  const [title, setTitle] = useState("");
  const [done, setDone] = useState<Added | null>(null);
  useEffect(() => {
    if (open && !roleKey && roles[0]) setRole(roles.find((r) => r.key === "buyer")?.key ?? roles[0].key);
  }, [open, roles, roleKey]);
  const m = useMutation(async () => {
    const out = await api.post<Added>("/portal/team", { fullName, phone, email: email || undefined, roleKey, title: title || undefined });
    setDone(out);
    onDone();
  });
  const close = () => {
    setDone(null);
    setName("");
    setPhone("");
    setEmail("");
    setTitle("");
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={done ? t("p.team.add.doneTitle") : t("p.team.add.title")} description={done ? t("p.team.add.doneBody") : t("p.team.add.body")}>
      {done ? (
        <div class="pt-stack">
          <dl class="pt-dl">
            <dt>{t("p.team.add.tempPassword")}</dt>
            <dd class="pt-ltr">{done.tempPassword}</dd>
          </dl>
          <div class="pt-row">
            <a class="pt-btn-link" href={done.whatsappUrl} target="_blank" rel="noopener noreferrer">
              <Button>{t("p.team.add.whatsapp")}</Button>
            </a>
            <Button variant="secondary" onClick={() => void copyText(done.message).then(() => toast({ tone: "success", message: t("p.team.code.copied") }))}>
              {t("p.team.add.copyMsg")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          class="pt-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void m.mutate(undefined);
          }}
        >
          {m.error ? <InlineAlert tone="danger">{m.error.message}</InlineAlert> : null}
          <Field label={t("p.team.add.name")} required>
            <Input value={fullName} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
          </Field>
          <Field label={t("p.team.add.phone")} required>
            <Input type="tel" inputMode="tel" class="pt-ltr" value={phone} onInput={(e) => setPhone((e.currentTarget as HTMLInputElement).value)} />
          </Field>
          <Field label={t("p.team.add.email")}>
            <Input type="email" class="pt-ltr" value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} />
          </Field>
          <Field label={t("p.team.add.role")} required>
            <Select value={roleKey} options={roles.map((r) => ({ value: r.key, label: r.name }))} onChange={(e) => setRole((e.currentTarget as HTMLSelectElement).value)} />
          </Field>
          <Field label={t("p.team.add.jobTitle")}>
            <Input value={title} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} />
          </Field>
          <Button type="submit" loading={m.loading}>
            {t("p.team.add.submit")}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

export function ResetLinkDialog({ memberId, onClose }: { memberId: number | null; onClose: () => void }) {
  const toast = useToast();
  const [out, setOut] = useState<{ url: string; delivered?: unknown[]; whatsappUrl: string } | null>(null);
  const m = useMutation(async (id: number) => {
    setOut(await api.post(`/portal/team/members/${id}/reset-link`));
  });
  useEffect(() => {
    setOut(null);
    if (memberId) void m.mutate(memberId);
  }, [memberId]);
  const sent = Array.isArray(out?.delivered) && out!.delivered!.length > 0;
  return (
    <Dialog open={memberId !== null} onClose={onClose} title={t("p.team.link.title")} description={t("p.team.link.body")}>
      <div class="pt-stack">
        {m.error ? <InlineAlert tone="danger">{m.error.message}</InlineAlert> : null}
        {m.loading ? <ListSkeleton rows={1} /> : null}
        {out ? (
          <>
            {sent ? <InlineAlert tone="success">{t("p.team.link.sent")}</InlineAlert> : null}
            <Input readOnly class="pt-ltr" value={out.url} onFocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
            <div class="pt-row">
              <a class="pt-btn-link" href={out.whatsappUrl} target="_blank" rel="noopener noreferrer">
                <Button>{t("p.team.add.whatsapp")}</Button>
              </a>
              <Button variant="secondary" onClick={() => void copyText(out.url).then(() => toast({ tone: "success", message: t("p.team.code.copied") }))}>
                {t("p.team.code.copy")}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

const actKey = (a: string) => `p.team.act.${a}` as CopyKey;
const KNOWN = new Set(["member.created", "member.updated", "member.password_reset", "member.suspended", "member.reactivated", "member.removed", "join.approved", "join.rejected", "company.code_rotated", "role.created", "role.updated", "role.deleted", "setting.changed"]);

export function ActivityTab() {
  const [before, setBefore] = useState<number | null>(null);
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const q = useQuery(
    async (signal) => {
      const r = await api.get<{ events: AuditEvent[]; nextBefore: number | null }>(`/portal/audit?limit=20${before ? `&before=${before}` : ""}`, { signal });
      setRows((prev) => (before ? [...prev, ...r.events] : r.events));
      return r;
    },
    [before],
  );
  if (q.error && !rows.length) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (q.loading && !rows.length) return <ListSkeleton />;
  if (!rows.length) return <EmptyState title={t("p.team.act.empty")} compact />;
  return (
    <div class="pt-stack">
      <ul class="pt-timeline-list">
        {rows.map((e) => (
          <li key={e.id} class="pt-act">
            <strong>{KNOWN.has(e.action) ? t(actKey(e.action)) : t("p.team.act.other")}</strong>
            <span class="pt-muted">
              {t("p.team.act.by", { who: e.actorLabel && e.actorLabel !== "owner" ? e.actorLabel : t("p.team.act.system") })} · {formatRelative(e.createdAt)}
            </span>
          </li>
        ))}
      </ul>
      {q.data?.nextBefore ? (
        <Button variant="secondary" loading={q.loading} onClick={() => setBefore(q.data!.nextBefore)}>
          {t("p.team.act.more")}
        </Button>
      ) : null}
    </div>
  );
}

export const statusTone = (s: string) => (s === "active" ? "success" : s === "suspended" ? "danger" : "warn") as "success" | "danger" | "warn";
export { StatusPill };
