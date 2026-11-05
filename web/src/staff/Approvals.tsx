import "../copy/approvalsAdmin";
import "../copy/approvals";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { staffUser } from "../admin/session";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, EmptyState, Field, InlineAlert, Stat, StatusPill, Tabs, Textarea, type Column } from "../design/components";
import { formatDateTime, formatMoney, formatNumber } from "../lib/format";
import { approveBlock, decidePayload, decisionError, slaTone, sortInbox, summarize, waitParts, type Decision, type InboxRow } from "./approvalsCore";
import { DelegationsPanel, PermissionsPanel, PoliciesPanel, SecurityPanel } from "./ApprovalsAdmin";
import { canEditGovernance, canManageDelegations } from "./approvalsAdminCore";
import "./Activity.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;

/** صندوق الاعتمادات: طلبات مستنية قراري، بمهلة ساعات العمل ومحاكي الأثر (إيه اللي هيحصل لو اعتمدت أو رفضت). */
export function Approvals() {
  const [tab, setTab] = useState<string>("pending");
  const role = staffUser()?.role;
  const pending = useQuery((signal) => api.get<{ data: InboxRow[] }>("/approvals/inbox?mode=pending", { signal }), []);
  const history = useQuery((signal) => api.get<{ data: InboxRow[] }>("/approvals/inbox?mode=history", { signal }), []);
  const [open, setOpen] = useState<InboxRow | null>(null);
  const rows = sortInbox(Array.isArray(pending.data?.data) ? pending.data!.data : []);
  const hist = Array.isArray(history.data?.data) ? history.data!.data : [];
  const sum = summarize(rows);
  const refresh = async () => { await pending.refetch(); await history.refetch(); };

  const pendingCols: Column<InboxRow>[] = [
    { key: "t", header: t("apv.col.request"), cell: (r) => <strong>{r.title}</strong>, mobile: "title" },
    { key: "by", header: t("apv.col.by"), cell: (r) => `${r.requesterName}${r.requesterRoleLabel ? ` (${r.requesterRoleLabel})` : ""}`, mobile: "hide" },
    { key: "a", header: t("apv.col.amount"), cell: (r) => formatMoney(r.amount), numeric: true },
    { key: "w", header: t("apv.col.wait"), cell: (r) => { const w = waitParts(r.waitedMinutes); return t("apv.wait", { h: formatNumber(w.h), m: formatNumber(w.m) }); }, mobile: "hide" },
    { key: "s", header: t("apv.col.sla"), cell: (r) => <StatusPill tone={slaTone(r.sla)}>{t(`apv.sla.${r.sla}` as CopyKey)}</StatusPill> },
    { key: "x", header: t("apv.col.action"), cell: (r) => <Button size="sm" onClick={() => setOpen(r)}>{t("apv.review")}</Button> },
  ];
  const historyCols: Column<InboxRow>[] = [
    { key: "t", header: t("apv.col.request"), cell: (r) => <strong>{r.title}</strong>, mobile: "title" },
    { key: "by", header: t("apv.col.by"), cell: (r) => r.requesterName, mobile: "hide" },
    { key: "a", header: t("apv.col.amount"), cell: (r) => formatMoney(r.amount), numeric: true },
    { key: "st", header: t("apv.col.status"), cell: (r) => <StatusPill tone={r.status === "approved" ? "success" : "danger"}>{t(`apv.status.${r.status}` as CopyKey)}</StatusPill> },
    { key: "d", header: t("apv.col.when"), cell: (r) => (r.decidedAt ? formatDateTime(r.decidedAt) : "—"), mobile: "hide" },
    { key: "n", header: t("apv.dlg.note"), cell: (r) => r.decisionNote ?? "—", mobile: "hide" },
  ];

  const pendingPanel = (
    <div>
      <div class="act-toolbar">
        <Stat label={t("apv.stat.total")} value={formatNumber(sum.total)} tone="brand" />
        <Stat label={t("apv.stat.overdue")} value={formatNumber(sum.overdue)} tone="danger" />
        <Stat label={t("apv.stat.soon")} value={formatNumber(sum.dueSoon)} tone="warn" />
        <Stat label={t("apv.stat.mine")} value={formatNumber(sum.mine)} />
      </div>
      {pending.error ? <InlineAlert tone="warn">{t("apv.loadFail")}</InlineAlert> : null}
      <DataTable columns={pendingCols} rows={rows} rowKey={(r) => r.id} caption={t("apv.caption")} loading={pending.loading} empty={<EmptyState title={t("apv.empty.pending")} compact />} />
    </div>
  );
  const historyPanel = (
    <div>
      {history.error ? <InlineAlert tone="warn">{t("apv.loadFail")}</InlineAlert> : null}
      <DataTable columns={historyCols} rows={hist} rowKey={(r) => r.id} caption={t("apv.caption")} loading={history.loading} empty={<EmptyState title={t("apv.empty.history")} compact />} />
    </div>
  );

  return (
    <div class="ad-page">
      <div>
        <h1 class="ad-title">{t("apv.title")}</h1>
        <p class="st-login__sub">{t("apv.subtitle")}</p>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "pending", label: t("apv.tab.pending"), panel: pendingPanel },
        { id: "history", label: t("apv.tab.history"), panel: historyPanel },
        ...(canManageDelegations(role) ? [
          { id: "delegations", label: t("apa.tab.delegations"), panel: <DelegationsPanel /> },
          { id: "policies", label: t("apa.tab.policies"), panel: <PoliciesPanel canEdit={canEditGovernance(role)} /> },
        ] : []),
        ...(canEditGovernance(role) ? [{ id: "permissions", label: t("apa.tab.permissions"), panel: <PermissionsPanel /> }] : []),
        { id: "security", label: t("apa.tab.security"), panel: <SecurityPanel canVerify={canEditGovernance(role)} /> },
      ]} />
      {open ? <ReviewDialog row={open} onClose={() => setOpen(null)} onDone={async () => { setOpen(null); await refresh(); }} /> : null}
    </div>
  );
}

function ReviewDialog({ row, onClose, onDone }: { row: InboxRow; onClose: () => void; onDone: () => Promise<void> }) {
  const act = useAct();
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const block = approveBlock(row);
  const decide = async (kind: Decision) => {
    setTried(true);
    if (decisionError(kind, note)) return;
    const ok = await act.run(async () => { await api.patch<unknown>(`/governance/approval-requests/${row.id}/decide`, decidePayload(kind, note)); return true; }, t(kind === "approve" ? "apv.dlg.approved" : "apv.dlg.rejected"));
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={t("apv.dlg.title", { title: row.title })} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
      <Button variant="danger" loading={act.busy} disabled={!row.verdict.canReject} onClick={() => void decide("reject")}>{t("apv.dlg.reject")}</Button>
      <Button loading={act.busy} disabled={!row.verdict.canApprove} onClick={() => void decide("approve")}>{t("apv.dlg.approve")}</Button></>}>
      <div class="act-list">
        <p>{t("apv.dlg.by", { name: row.requesterName, role: row.requesterRoleLabel })}</p>
        <p>{formatMoney(row.amount)}</p>
        <p class="act-muted">{t("apv.dlg.step", { roles: row.stepRoleLabels.join(" / ") })}</p>
        <h3 class="act-day">{t("apv.dlg.ifApprove")}</h3>
        <ul>{row.impact.approve.map((x) => <li key={x}>{x}</li>)}</ul>
        <h3 class="act-day">{t("apv.dlg.ifReject")}</h3>
        <ul>{row.impact.reject.map((x) => <li key={x}>{x}</li>)}</ul>
        {block ? <InlineAlert tone="warn">{t(`apv.block.${block}` as CopyKey)}</InlineAlert> : null}
        {row.verdict.selfException ? <InlineAlert tone="info">{t("apv.exception")}</InlineAlert> : null}
        <Field label={t("apv.dlg.note")} hint={t("apv.dlg.noteHint")} error={tried && note.trim().length < 3 ? t("apv.dlg.noteErr") : undefined}>
          <Textarea value={note} maxLength={500} onInput={(e) => setNote(val(e))} />
        </Field>
      </div>
    </Dialog>
  );
}
