import { useEffect, useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Avatar, Button, Card, Dialog, EmptyState, InlineAlert, Select, Section, Switch, Tabs, useToast } from "../../design/components";
import { Download, Plus, RefreshCw } from "../../design/icons";
import { navigate, usePath } from "../../app/router";
import { useMutation, useQuery } from "../../api/hooks";
import { copyText } from "../../lib/clipboard";
import { qrSvg } from "../../lib/qr";
import { formatNumber, formatRelative } from "../../lib/format";
import { api } from "../api";
import { can } from "../session";
import type { CompanyInfo, TeamMember, TeamRole } from "../types";
import { ListSkeleton, LoadError } from "./shared";
import { ActivityTab, AddMemberDialog, ResetLinkDialog, StatusPill, statusTone } from "./TeamParts";

const statusLabel = (s: string) => t(`p.team.status.${s}` as CopyKey);

function CodeCard() {
  const toast = useToast();
  const q = useQuery((signal) => api.get<CompanyInfo>("/portal/company", { signal }));
  const [qr, setQr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const code = q.data?.joinCode?.code ?? null;
  useEffect(() => {
    setQr(null);
    if (code) void qrSvg(code, { size: 160 }).then(setQr).catch(() => setQr(null));
  }, [code]);
  const rotate = useMutation(async () => {
    await api.post("/portal/company/code/rotate");
    setConfirm(false);
    await q.refetch();
  });
  const setting = useMutation(async (p: { key: string; value: unknown }) => {
    await api.put("/portal/company/settings", p);
    await q.refetch();
    toast({ tone: "success", message: t("p.team.done") });
  });
  const canSettings = can("company.settings");
  const mode = String(q.data?.settings["join.mode"] ?? "approval");
  const enabled = q.data?.settings["join.code.enabled"] !== false;
  return (
    <Section title={t("p.team.code.title")}>
      <Card pad class="pt-stack">
        {q.error ? <LoadError error={q.error} onRetry={() => void q.refetch()} /> : null}
        {q.loading && !q.data ? <ListSkeleton rows={1} /> : null}
        {q.data ? (
          code ? (
            <>
              <p class="pt-muted">{t("p.team.code.body")}</p>
              <div class="pt-code pt-ltr" aria-label={t("p.team.code.title")}>{code}</div>
              <p class="pt-muted">{t("p.team.code.uses", { n: formatNumber(q.data.joinCode!.uses) })}</p>
              {qr ? <div class="pt-qr" role="img" aria-label={t("p.team.code.qr")} dangerouslySetInnerHTML={{ __html: qr }} /> : null}
              <div class="pt-row">
                <Button icon={Download} onClick={() => void copyText(code).then(() => toast({ tone: "success", message: t("p.team.code.copied") }))}>
                  {t("p.team.code.copy")}
                </Button>
                {can("company.manage_code") ? (
                  <Button variant="secondary" icon={RefreshCw} onClick={() => setConfirm(true)}>
                    {t("p.team.code.rotate")}
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <p class="pt-muted">{t("p.team.code.none")}</p>
          )
        ) : null}
        {canSettings && q.data ? (
          <>
            <Select
              aria-label={t("p.team.join.mode")}
              value={mode}
              options={(["approval", "auto", "disabled"] as const).map((v) => ({ value: v, label: `${t("p.team.join.mode")}: ${t(`p.team.join.${v}` as CopyKey)}` }))}
              onChange={(e) => void setting.mutate({ key: "join.mode", value: (e.currentTarget as HTMLSelectElement).value })}
            />
            <Switch label={t("p.team.join.mode")} checked={enabled} onChange={(v) => void setting.mutate({ key: "join.code.enabled", value: v })} />
          </>
        ) : null}
        {setting.error ? <InlineAlert tone="danger">{setting.error.message}</InlineAlert> : null}
      </Card>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={t("p.team.code.rotate")} description={t("p.team.code.rotateBody")}>
        <div class="pt-row">
          <Button loading={rotate.loading} onClick={() => void rotate.mutate(undefined)}>{t("p.team.code.rotate")}</Button>
          <Button variant="secondary" onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
        </div>
      </Dialog>
    </Section>
  );
}

function MemberRow({ m, roles, onChanged, onReset }: { m: TeamMember; roles: TeamRole[]; onChanged: () => void; onReset: (id: number) => void }) {
  const [confirm, setConfirm] = useState(false);
  const manage = can("team.manage") && !m.isOwner;
  const act = useMutation(async (a: "suspend" | "reactivate" | "remove") => {
    await api.post(`/portal/team/${m.memberId}/${a}`);
    setConfirm(false);
    onChanged();
  });
  const role = useMutation(async (roleKey: string) => {
    await api.patch(`/portal/team/${m.memberId}`, { roleKey });
    onChanged();
  });
  return (
    <Card pad class="pt-member">
      <div class="pt-row">
        <Avatar name={m.fullName} />
        <div class="pt-grow">
          <strong>{m.fullName}</strong>
          <div class="pt-muted">{m.isOwner ? t("p.team.owner") : m.roleName}{m.title ? ` · ${m.title}` : ""}</div>
          <div class="pt-muted pt-ltr">{m.phone}</div>
          <div class="pt-muted">{m.lastActiveAt ? t("p.team.lastSeen", { when: formatRelative(m.lastActiveAt) }) : t("p.team.neverSeen")}</div>
        </div>
        <StatusPill tone={statusTone(m.status)}>{statusLabel(m.status)}</StatusPill>
      </div>
      {manage ? (
        <div class="pt-row">
          <Select
            aria-label={t("p.team.changeRole")}
            value={m.roleKey}
            options={roles.map((r) => ({ value: r.key, label: r.name }))}
            onChange={(e) => void role.mutate((e.currentTarget as HTMLSelectElement).value)}
          />
          {m.status === "active" ? (
            <Button size="sm" variant="secondary" loading={act.loading} onClick={() => void act.mutate("suspend")}>{t("p.team.suspend")}</Button>
          ) : null}
          {m.status === "suspended" ? (
            <Button size="sm" variant="secondary" loading={act.loading} onClick={() => void act.mutate("reactivate")}>{t("p.team.reactivate")}</Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => onReset(m.memberId)}>{t("p.team.resetLink")}</Button>
          <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>{t("p.team.remove")}</Button>
        </div>
      ) : null}
      {act.error || role.error ? <InlineAlert tone="danger">{(act.error ?? role.error)!.message}</InlineAlert> : null}
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={t("p.team.confirmRemove", { name: m.fullName })} description={t("p.team.confirmRemoveBody")}>
        <div class="pt-row">
          <Button variant="danger" loading={act.loading} onClick={() => void act.mutate("remove")}>{t("p.team.remove")}</Button>
          <Button variant="secondary" onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
        </div>
      </Dialog>
    </Card>
  );
}

function MembersTab() {
  const [adding, setAdding] = useState(false);
  const [resetId, setResetId] = useState<number | null>(null);
  const team = useQuery((signal) => api.get<{ members: TeamMember[]; maxMembers: number }>("/portal/team", { signal }));
  const roles = useQuery((signal) => api.get<{ roles: TeamRole[] }>("/portal/roles", { signal }));
  const list = (team.data?.members ?? []).filter((m) => m.status !== "pending_approval");
  const active = list.filter((m) => m.status === "active").length;
  return (
    <div class="pt-stack">
      <CodeCard />
      <Section
        title={t("p.team.tab.members")}
        actions={can("team.invite") ? <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>{t("p.team.add")}</Button> : undefined}
      >
        {team.error ? <LoadError error={team.error} onRetry={() => void team.refetch()} /> : null}
        {team.loading && !team.data ? <ListSkeleton /> : null}
        {team.data ? <p class="pt-muted">{t("p.team.seats", { n: formatNumber(active), max: formatNumber(team.data.maxMembers) })}</p> : null}
        {team.data && !list.length ? <EmptyState title={t("p.team.empty")} compact /> : null}
        <div class="pt-list">
          {list.map((m) => (
            <MemberRow key={m.memberId} m={m} roles={roles.data?.roles ?? []} onChanged={() => void team.refetch()} onReset={setResetId} />
          ))}
        </div>
      </Section>
      <AddMemberDialog open={adding} onClose={() => setAdding(false)} roles={roles.data?.roles ?? []} onDone={() => void team.refetch()} />
      <ResetLinkDialog memberId={resetId} onClose={() => setResetId(null)} />
    </div>
  );
}

function RequestsTab() {
  const q = useQuery((signal) => api.get<{ requests: TeamMember[] }>("/portal/team/requests", { signal }));
  const act = useMutation(async (p: { id: number; a: "approve" | "reject" }) => {
    await api.post(`/portal/team/requests/${p.id}/${p.a}`);
    await q.refetch();
  });
  if (q.error) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (q.loading && !q.data) return <ListSkeleton />;
  if (!q.data?.requests.length) return <EmptyState title={t("p.team.req.empty")} compact />;
  return (
    <div class="pt-list">
      {act.error ? <InlineAlert tone="danger">{act.error.message}</InlineAlert> : null}
      {q.data.requests.map((m) => (
        <Card key={m.memberId} pad class="pt-member">
          <div class="pt-row">
            <Avatar name={m.fullName} />
            <div class="pt-grow">
              <strong>{m.fullName}</strong>
              <div class="pt-muted pt-ltr">{m.phone}</div>
            </div>
          </div>
          <div class="pt-row">
            <Button size="sm" loading={act.loading} onClick={() => void act.mutate({ id: m.memberId, a: "approve" })}>{t("p.team.req.approve")}</Button>
            <Button size="sm" variant="secondary" onClick={() => void act.mutate({ id: m.memberId, a: "reject" })}>{t("p.team.req.reject")}</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function Team() {
  usePath();
  const tab = new URLSearchParams(location.search).get("tab") ?? "members";
  const go = (id: string) => navigate(`/portal/team${id === "members" ? "" : `?tab=${id}`}`);
  const tabs = [{ id: "members", label: t("p.team.tab.members"), panel: <MembersTab /> }];
  if (can("team.approve_join")) tabs.push({ id: "requests", label: t("p.team.tab.requests"), panel: <RequestsTab /> });
  if (can("audit.view")) tabs.push({ id: "activity", label: t("p.team.tab.activity"), panel: <ActivityTab /> });
  return (
    <>
      <h1 class="pt-page-title">{t("p.team.title")}</h1>
      <Tabs value={tab} onChange={go} tabs={tabs} />
    </>
  );
}
