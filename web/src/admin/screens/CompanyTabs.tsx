import { useState } from "preact/hooks";
import { ar, t, type CopyKey } from "../../copy";
import { Button, Card, Checkbox, ConfirmDialog, CopyField, Dialog, EmptyState, InlineAlert, Section, Select, ShareLinkCard, Stat, Timeline, Field, Input, useToast, StatusPill, type TimelineItem } from "../../design/components";
import { Ban, Download, Inbox, KeyRound, Link2, Lock, Play, RefreshCw, Send, Undo2 } from "../../design/icons";
import { useQuery } from "../../api/hooks";
import { ApiError } from "../../api/client";
import { Link } from "../../app/router";
import { formatDate, formatDateTime, formatNumber, formatRelative } from "../../lib/format";
import { api, downloadCsv } from "../api";
import { useAct } from "../act";
import { HealthBadge, Row, StatusBadge, TypeToConfirm, memberStatusLabel } from "../parts";
import { SettingField, optLabel } from "../SettingField";
import type { AuditResponse, CompanyDetail, HistoryItem, Meta, OutboxItem } from "../types";

interface Props {
  d: CompanyDetail;
  reload: () => Promise<void>;
  onListChanged: () => void;
}

/** الحد الأدنى للطلب: عدد صحيح من 1 لحد 7 خانات (السيرفر بيتحقق كمان). */
export const MIN_ORDER_PATTERN = /^[1-9][0-9]{0,6}$/;

/* ---------------- نظرة عامة ---------------- */
export function OverviewTab({ d, reload, onListChanged }: Props) {
  const c = d.company;
  const { run, busy } = useAct();
  const meta = useQuery((signal) => api.get<Meta>("/portal-companies/meta", { signal }), []);
  const toast = useToast();
  const [suspend, setSuspend] = useState(false);
  const [archive, setArchive] = useState(false);
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [openOrdersMsg, setOpenOrdersMsg] = useState<string | null>(null);
  const [activation, setActivation] = useState<{ url: string; whatsappUrl?: string | null } | null>(null);
  const [adminCode, setAdminCode] = useState<{ code: string; minutes: number } | null>(null);
  const [minOrder, setMinOrder] = useState(String(c.minimumOrderQuantity));
  const minValid = MIN_ORDER_PATTERN.test(minOrder.trim());

  const saveMinOrder = async () => {
    const r = await run(() => api.patch(`/portal-customers/${c.id}/minimum-order`, { minimumOrderQuantity: Number(minOrder) }), t("a.ov.minOrder.done"));
    if (r !== undefined) {
      await reload();
      onListChanged();
    }
  };
  const saveCity = async (city: string) => {
    const r = await run(() => api.patch(`/portal-customers/${c.id}/city`, { city: city || null }), t("a.ov.city.done"));
    if (r !== undefined) {
      await reload();
      onListChanged();
    }
  };

  const bulk = async (body: Record<string, unknown>) => {
    const ok = await run(() => api.post("/portal-companies/bulk", { ids: [c.id], ...body }), t("common.saved"));
    if (ok !== undefined) {
      await reload();
      onListChanged();
    }
    return ok;
  };
  const closeArchive = () => {
    setArchive(false);
    setReason("");
    setAck(false);
    setOpenOrdersMsg(null);
  };
  const doArchive = async () => {
    const r = await run(async () => {
      try {
        return await api.post(`/portal-companies/${c.id}/archive`, { reason, acknowledgeOpenOrders: ack });
      } catch (e) {
        if (e instanceof ApiError && e.code === "COMPANY_HAS_OPEN_ORDERS") {
          setOpenOrdersMsg(e.message);
          return null;
        }
        throw e;
      }
    });
    if (r) {
      toast({ tone: "success", message: t("a.ov.archive.done") });
      closeArchive();
      await reload();
      onListChanged();
    }
  };
  const doRestore = async () => {
    const r = await run(() => api.post(`/portal-companies/${c.id}/restore`, {}), t("a.ov.restore.done"));
    if (r !== undefined) {
      await reload();
      onListChanged();
    }
  };
  const issueLink = async () => {
    const r = await run(() => api.post<{ activation: { url: string; whatsappUrl?: string | null } }>(`/portal-customers/${c.id}/activation-link`, {}));
    if (r?.activation?.url) setActivation({ url: r.activation.url, whatsappUrl: r.activation.whatsappUrl });
  };
  const issueCode = async () => {
    const r = await run(() => api.post<{ code: string; minutes: number }>(`/portal-customers/${c.id}/admin-code`, {}));
    if (r) setAdminCode({ code: r.code, minutes: r.minutes });
  };

  return (
    <div class="ad-stack">
      <div class="ad-stats">
        <Stat label={t("a.ov.orders")} value={formatNumber(c.ordersCount)} />
        <Stat label={t("a.ov.lastOrder")} value={c.lastOrderAt ? formatRelative(c.lastOrderAt) : t("a.never")} />
        <Stat label={t("a.ov.members")} value={formatNumber(c.membersCount)} hint={c.pendingJoin ? t("a.ov.pending", { n: c.pendingJoin }) : undefined} tone={c.pendingJoin ? "warn" : "neutral"} />
        <Stat label={t("a.ov.activity")} value={c.lastActivityAt ? formatRelative(c.lastActivityAt) : t("a.never")} />
      </div>
      <Card class="ad-stack">
        <dl class="ad-kvs">
          <Row label={t("a.ov.status")}><StatusBadge status={c.status} /></Row>
          <Row label={t("a.ov.health")}><HealthBadge level={c.health.level} label={c.health.label} /></Row>
          <Row label={t("a.ov.owner")}>{c.ownerName} · <bdi dir="ltr">{c.phone}</bdi></Row>
          {c.email ? <Row label={t("a.ov.email")}><bdi dir="ltr">{c.email}</bdi></Row> : null}
          <Row label={t("a.ov.governorate")}>{c.governorate ?? t("a.none")}</Row>
          <Row label={t("a.ov.created")}>{formatDate(c.createdAt)}</Row>
        </dl>
      </Card>
      <Card class="ad-stack">
        <Field label={t("a.ov.sales")}>
          <Select
            value={c.salesUserId ? String(c.salesUserId) : ""}
            disabled={busy || !meta.data}
            options={[{ value: "", label: t("a.ov.salesNone") }, ...(meta.data?.salesUsers ?? []).map((u) => ({ value: String(u.id), label: u.fullName }))]}
            onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; void bulk({ action: "assignSales", salesUserId: v ? Number(v) : null }); }}
          />
        </Field>
        <Field label={t("a.ov.segment")}>
          <Select
            value={c.segment ?? ""}
            disabled={busy || !meta.data}
            placeholder={t("a.ov.segmentNone")}
            options={(meta.data?.segments ?? []).map((s) => ({ value: s, label: optLabel(s) }))}
            onChange={(e) => void bulk({ action: "segment", segment: (e.currentTarget as HTMLSelectElement).value })}
          />
        </Field>
        <Field label={t("a.ov.governorate")}>
          <Select
            value={c.governorate ?? ""}
            disabled={busy || !meta.data}
            placeholder={t("a.none")}
            options={(meta.data?.governorates ?? []).map((g) => ({ value: g, label: g }))}
            onChange={(e) => void saveCity((e.currentTarget as HTMLSelectElement).value)}
          />
        </Field>
        <Field label={t("a.ov.minOrder")} error={minOrder.trim() !== "" && !minValid ? t("a.ov.minOrder.invalid") : undefined}>
          <div class="ad-row">
            <Input inputMode="numeric" dir="ltr" value={minOrder} onInput={(e) => setMinOrder((e.currentTarget as HTMLInputElement).value)} />
            <Button variant="secondary" loading={busy} disabled={!minValid || Number(minOrder) === c.minimumOrderQuantity} onClick={() => void saveMinOrder()}>{t("a.ov.minOrder.save")}</Button>
          </div>
        </Field>
      </Card>
      <Section title={t("a.ov.actions")}>
        <div class="ad-row">
          {c.status === "not_activated" ? <Button icon={Link2} onClick={() => void issueLink()} loading={busy}>{t("a.ov.activationLink")}</Button> : null}
          <Button variant="secondary" icon={KeyRound} onClick={() => void issueCode()} loading={busy}>{t("a.ov.adminCode")}</Button>
          {c.status === "archived" ? (
            <Button icon={Undo2} onClick={() => void doRestore()} loading={busy}>{t("a.ov.restore")}</Button>
          ) : (
            <>
              {c.status === "suspended" ? (
                <Button variant="secondary" icon={Play} onClick={() => void bulk({ action: "status", status: "reactivate" })} loading={busy}>{t("a.ov.reactivate")}</Button>
              ) : (
                <Button variant="danger" icon={Ban} onClick={() => setSuspend(true)}>{t("a.ov.suspend")}</Button>
              )}
              <Button variant="ghost" icon={Inbox} onClick={() => setArchive(true)}>{t("a.ov.archive")}</Button>
            </>
          )}
        </div>
        {c.status === "archived" ? (
          <InlineAlert tone="info">
            {t("a.ov.archived.info")}
            {c.archiveReason ? <> {t("a.ov.archived.reason", { reason: c.archiveReason })}</> : null}
          </InlineAlert>
        ) : null}
      </Section>
      <Dialog
        open={archive}
        onClose={closeArchive}
        title={t("a.ov.archive.title")}
        description={t("a.ov.archive.body")}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={closeArchive}>{t("common.cancel")}</Button>
            <Button variant="danger" disabled={reason.trim().length < 3 || (openOrdersMsg !== null && !ack)} loading={busy} onClick={() => void doArchive()}>{t("a.ov.archive.ok")}</Button>
          </>
        }
      >
        <div class="ad-stack">
          <Field label={t("a.ov.archive.reason")}>
            <Input value={reason} maxLength={500} onInput={(e) => setReason((e.currentTarget as HTMLInputElement).value)} autoComplete="off" />
          </Field>
          {openOrdersMsg ? (
            <>
              <InlineAlert tone="warn">{openOrdersMsg}</InlineAlert>
              <Checkbox label={t("a.ov.archive.ack")} checked={ack} onChange={(e) => setAck((e.currentTarget as HTMLInputElement).checked)} />
            </>
          ) : null}
        </div>
      </Dialog>
      <TypeToConfirm
        open={suspend}
        onClose={() => setSuspend(false)}
        loading={busy}
        title={t("a.ov.suspend.title")}
        description={t("a.ov.suspend.body")}
        phrase={c.companyName}
        confirmLabel={t("a.ov.suspend.ok")}
        onConfirm={async () => {
          const ok = await bulk({ action: "status", status: "suspend" });
          if (ok !== undefined) setSuspend(false);
        }}
      />
      <Dialog open={!!activation} onClose={() => setActivation(null)} title={t("a.ov.activationLink.title")} description={t("a.once")} footer={<Button onClick={() => setActivation(null)}>{t("common.done")}</Button>}>
        {activation ? <ShareLinkCard url={activation.url} title={t("a.ov.activationLink.card")} whatsappPhone={c.phone} whatsappText={t("a.ov.activationLink.wa", { url: activation.url })} /> : null}
      </Dialog>
      <Dialog open={!!adminCode} onClose={() => setAdminCode(null)} title={t("a.ov.adminCode.title")} description={t("a.ov.adminCode.body", { n: adminCode?.minutes ?? 0 })} footer={<Button onClick={() => setAdminCode(null)}>{t("common.done")}</Button>}>
        {adminCode ? <CopyField label={t("a.ov.adminCode.label")} value={adminCode.code} /> : null}
      </Dialog>
    </div>
  );
}

/* ---------------- الأوردرات ---------------- */
export function OrdersTab({ d }: Props) {
  return (
    <div class="ad-stack">
      {d.recentOrders.length ? (
        <ul class="ad-list">
          {d.recentOrders.map((o) => (
            <li key={o.id} class="ad-list__item">
              <strong class="num">{o.orderNumber}</strong>
              <span class="ad-muted">{formatDateTime(o.createdAt)}</span>
              <StatusPill tone="neutral">{o.status}</StatusPill>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact title={t("a.orders.empty")} />
      )}
      <div>
        <Link class="ht-btn ht-btn--secondary" to={`/admin/portal-orders?status=all&q=${encodeURIComponent(d.company.companyName)}`}><span class="ht-btn__label">{t("a.orders.open")}</span></Link>
      </div>
    </div>
  );
}

/* ---------------- المحادثة ---------------- */
export function ChatTab({ d, reload }: Props) {
  const mode = d.settings.find((s) => s.key === "chat.mode");
  const { run, busy } = useAct();
  return (
    <div class="ad-stack">
      {mode ? (
        <SettingField
          label={mode.label}
          description={mode.description}
          shape={mode.shape}
          value={mode.value}
          inherited={mode.source === "inherited"}
          saving={busy}
          onSave={(v) => void run(() => api.put(`/portal-companies/${d.company.id}/settings/${mode.key}`, { value: v }), t("common.saved")).then(reload)}
          onReset={() => void run(() => api.put(`/portal-companies/${d.company.id}/settings/${mode.key}`, { reset: true }), t("common.saved")).then(reload)}
        />
      ) : null}
      <div>
        <Link class="ht-btn ht-btn--secondary" to={`/admin/portal-chat?q=${encodeURIComponent(d.company.companyName)}`}><span class="ht-btn__label">{t("a.chat.open")}</span></Link>
      </div>
    </div>
  );
}

/* ---------------- الأمان ---------------- */
export function SecurityTab({ d, reload }: Props) {
  const { run, busy } = useAct();
  const toast = useToast();
  const outbox = useQuery((signal) => api.get<{ items: OutboxItem[] }>(`/portal-customers/${d.company.id}/outbox`, { signal }), [d.company.id]);
  const [rotate, setRotate] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [revokeFor, setRevokeFor] = useState<number | null>(null);
  const names = new Map(d.members.map((m) => [m.memberId, m.fullName]));
  const code = d.joinCode;

  return (
    <div class="ad-stack">
      <Section title={t("a.sec.code")}>
        <Card class="ad-stack">
          {code ? (
            <>
              <CopyField label={t("a.sec.code")} value={code.code} />
              <p class="ad-muted">
                {t("a.sec.code.uses", { n: code.uses })}
                {code.maxUses ? ` · ${t("a.sec.code.max", { n: code.maxUses })}` : ""}
                {code.expiresAt ? ` · ${t("a.sec.code.expires", { d: formatDate(code.expiresAt) })}` : ""}
              </p>
            </>
          ) : (
            <p class="ad-muted">{t("a.sec.code.none")}</p>
          )}
          <div><Button variant="secondary" icon={RefreshCw} onClick={() => setRotate(true)}>{t("a.sec.rotate")}</Button></div>
        </Card>
      </Section>
      <Section title={t("a.sec.sessions")}>
        {d.sessions.length ? (
          <ul class="ad-list">
            {d.sessions.map((s) => (
              <li key={s.id} class="ad-list__item">
                <strong>{(s.memberId && names.get(s.memberId)) || t("a.sec.unknownMember")}</strong>
                <span class="ad-muted">{s.deviceLabel || t("a.sec.device")} · <bdi dir="ltr">{s.ipAddress ?? "—"}</bdi> · {formatRelative(s.lastActiveAt)}</span>
                {s.memberId ? <Button size="sm" variant="ghost" icon={Lock} onClick={() => setRevokeFor(s.memberId)}>{t("a.team.act.revoke")}</Button> : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact title={t("a.sec.noSessions")} />
        )}
      </Section>
      <Section title={t("a.sec.outbox")} description={t("a.sec.outbox.sub")}>
        {outbox.data?.items?.length ? (
          <ul class="ad-list">
            {outbox.data.items.map((o) => (
              <li key={o.id} class="ad-list__item">
                <strong>{optLabel(o.channel)}</strong>
                <span class="ad-muted">{o.maskedDestination ?? "—"} · {formatRelative(o.createdAt)}</span>
                <StatusPill tone={o.status === "sent" ? "success" : o.status === "failed" ? "danger" : "warn"}>{`a.outbox.${o.status}` in ar ? t(`a.outbox.${o.status}` as CopyKey) : o.status}</StatusPill>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact title={t("a.sec.outbox.empty")} />
        )}
      </Section>
      <TypeToConfirm
        open={rotate}
        onClose={() => setRotate(false)}
        loading={busy}
        title={t("a.sec.rotate.title")}
        description={t("a.sec.rotate.body")}
        phrase={d.company.companyName}
        confirmLabel={t("a.sec.rotate.ok")}
        onConfirm={async () => {
          const r = await run(() => api.post<{ code: string }>(`/portal-companies/${d.company.id}/code/rotate`, {}));
          if (r) {
            setRotate(false);
            setFresh(r.code);
            await reload();
          }
        }}
      />
      <Dialog open={!!fresh} onClose={() => setFresh(null)} title={t("a.sec.rotate.done")} description={t("a.once")} footer={<Button onClick={() => setFresh(null)}>{t("common.done")}</Button>}>
        {fresh ? <CopyField label={t("a.sec.code")} value={fresh} /> : null}
      </Dialog>
      <ConfirmDialog
        open={revokeFor !== null}
        onClose={() => setRevokeFor(null)}
        loading={busy}
        title={t("a.team.confirm.revoke.title", { name: (revokeFor && names.get(revokeFor)) || "" })}
        description={t("a.team.confirm.revoke.body")}
        confirmLabel={t("a.team.confirm.revoke.ok")}
        onConfirm={async () => {
          if (!revokeFor) return;
          const ok = await run(() => api.post(`/portal-companies/${d.company.id}/members/${revokeFor}/revoke-sessions`, {}), t("a.done"));
          if (ok !== undefined) {
            setRevokeFor(null);
            await reload();
          } else toast({ tone: "danger", message: t("error.generic") });
        }}
      />
    </div>
  );
}

/* ---------------- إعدادات الشركة ---------------- */
export function SettingsTab({ d, reload }: Props) {
  const { run, busy } = useAct();
  const [errKey, setErrKey] = useState<{ key: string; msg: string } | null>(null);
  const hist = useQuery((signal) => api.get<{ items: HistoryItem[] }>(`/portal-companies/${d.company.id}/settings-history`, { signal }), [d.company.id, JSON.stringify(d.settings.map((s) => s.source))]);
  const put = async (key: string, body: unknown) => {
    setErrKey(null);
    try {
      await api.put(`/portal-companies/${d.company.id}/settings/${key}`, body);
      await reload();
      await hist.refetch();
    } catch (e) {
      setErrKey({ key, msg: (e as Error).message });
    }
  };
  const groups = [...new Set(d.settings.map((s) => s.group))];
  return (
    <div class="ad-stack">
      <InlineAlert tone="info">{t("a.cset.info")}</InlineAlert>
      {groups.map((g) => (
        <Section key={g} title={`a.group.${g}` in ar ? t(`a.group.${g}` as CopyKey) : g}>
          <div class="ad-stack">
            {d.settings.filter((s) => s.group === g).map((s) => (
              <SettingField
                key={s.key}
                label={s.label}
                description={s.description}
                shape={s.shape}
                value={s.value}
                inherited={s.source === "inherited"}
                saving={busy}
                error={errKey?.key === s.key ? errKey.msg : null}
                onSave={(v) => void run(() => put(s.key, { value: v }), t("common.saved"))}
                onReset={() => void run(() => put(s.key, { reset: true }), t("common.saved"))}
              />
            ))}
          </div>
        </Section>
      ))}
      <Section title={t("a.hist.title")}>
        <HistoryList items={hist.data?.items ?? []} onRevert={(id) => run(async () => { await api.post(`/portal-companies/${d.company.id}/settings-history/${id}/revert`, {}); await reload(); await hist.refetch(); }, t("a.hist.reverted"))} />
      </Section>
    </div>
  );
}

export function HistoryList({ items, onRevert }: { items: HistoryItem[]; onRevert: (id: number) => Promise<unknown> }) {
  if (!items.length) return <EmptyState compact title={t("a.hist.empty")} />;
  const show = (v: unknown) => (v === null || v === undefined ? t("a.hist.default") : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <ul class="ad-list">
      {items.map((h) => (
        <li key={h.id} class="ad-list__item">
          <strong>{h.key}</strong>
          <span class="ad-muted">
            {t("a.hist.line", { who: h.changedByName, when: formatDateTime(h.createdAt), from: h.hadBefore ? show(h.beforeValue) : t("a.hist.default"), to: h.hasAfter ? show(h.afterValue) : t("a.hist.default") })}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void onRevert(h.id)}>{t("a.hist.revert")}</Button>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- السجل ---------------- */
const LOG_ACTIONS = ["member.created", "member.updated", "member.suspended", "member.reactivated", "member.removed", "member.sessions_revoked", "member.reset_link_issued", "company.code_rotated", "company.sales_assigned", "company.segment_changed", "company.suspended", "company.reactivated", "company.archived", "company.restored", "setting.changed", "setting.reverted", "join.requested", "join.approved", "join.rejected", "order.cancelled"];

export function sentence(a: { action: string; actorName: string; targetName: string | null }): string {
  const k = `a.log.${a.action}`;
  const who = a.actorName || t("a.log.someone");
  if (k in ar) return t(k as CopyKey, { who, target: a.targetName ?? t("a.log.someone") });
  return t("a.log.unknown", { who, action: a.action });
}

export function LogTab({ d }: Props) {
  const id = d.company.id;
  const [action, setAction] = useState("");
  const [memberId, setMemberId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const q = { action, memberId, from, to, page, pageSize: 30 };
  const res = useQuery((signal) => api.get<AuditResponse>(`/portal-companies/${id}/audit`, { query: q, signal }), [id, action, memberId, from, to, page]);
  const items: TimelineItem[] = (res.data?.items ?? []).map((a) => ({
    id: a.id,
    title: sentence(a),
    meta: formatDateTime(a.createdAt),
    tone: a.action.includes("removed") || a.action.includes("suspended") || a.action.includes("revoked") ? "warn" : "neutral",
  }));
  const [raw, setRaw] = useState<number | null>(null);
  const reset = () => { setAction(""); setMemberId(""); setFrom(""); setTo(""); setPage(1); };
  const total = res.data?.total ?? 0;
  const detail = res.data?.items.find((a) => a.id === raw);
  return (
    <div class="ad-stack">
      <div class="ad-grid2">
        <Field label={t("a.log.f.action")}>
          <Select value={action} onChange={(e) => { setAction((e.currentTarget as HTMLSelectElement).value); setPage(1); }} options={[{ value: "", label: t("a.log.f.all") }, ...LOG_ACTIONS.map((a) => ({ value: a, label: sentence({ action: a, actorName: t("a.log.someone"), targetName: null }) }))]} />
        </Field>
        <Field label={t("a.log.f.member")}>
          <Select value={memberId} onChange={(e) => { setMemberId((e.currentTarget as HTMLSelectElement).value); setPage(1); }} options={[{ value: "", label: t("a.log.f.all") }, ...d.members.map((m) => ({ value: String(m.memberId), label: m.fullName }))]} />
        </Field>
        <Field label={t("a.log.f.from")}><Input type="date" value={from} onInput={(e) => { setFrom((e.currentTarget as HTMLInputElement).value); setPage(1); }} /></Field>
        <Field label={t("a.log.f.to")}><Input type="date" value={to} onInput={(e) => { setTo((e.currentTarget as HTMLInputElement).value); setPage(1); }} /></Field>
      </div>
      <div class="ad-row ad-row--between">
        <Button variant="ghost" size="sm" onClick={reset}>{t("common.clearFilters")}</Button>
        <Button variant="secondary" size="sm" icon={Download} onClick={() => void downloadCsv(`/portal-companies/${id}/audit.csv`, { action, memberId, from, to }, `company-${id}-activity.csv`)}>{t("a.csv")}</Button>
      </div>
      {res.error ? <InlineAlert tone="danger">{res.error.message}</InlineAlert> : null}
      {items.length ? <Timeline items={items} /> : res.loading ? <p class="ad-muted">{t("common.loading")}</p> : <EmptyState compact title={t("a.log.empty")} />}
      {res.data?.items.length ? (
        <div class="ad-row">
          {res.data.items.map((a) => (
            <Button key={a.id} size="sm" variant="ghost" onClick={() => setRaw(raw === a.id ? null : a.id)} aria-label={`${t("a.log.raw")} ${a.id}`}>{`#${a.id}`}</Button>
          ))}
        </div>
      ) : null}
      {detail ? <pre class="ad-raw" dir="ltr">{JSON.stringify({ action: detail.action, before: detail.before, after: detail.after }, null, 2)}</pre> : null}
      <div class="ad-row ad-row--between">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("table.prev")}</Button>
        <span class="ad-muted num">{t("table.rowsOf", { from: Math.min(total, (page - 1) * 30 + 1), to: Math.min(total, page * 30), total })}</span>
        <Button size="sm" variant="secondary" disabled={page * 30 >= total} onClick={() => setPage(page + 1)}>{t("table.next")}</Button>
      </div>
    </div>
  );
}
