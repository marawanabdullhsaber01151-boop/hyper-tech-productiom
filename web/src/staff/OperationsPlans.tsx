import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Drawer, EmptyState, Field, InlineAlert, Select, Skeleton, StatusPill, Textarea, type Column } from "../design/components";
import { CircleCheck } from "../design/icons";
import { formatMoney, formatNumber, formatRelative } from "../lib/format";
import { canSubmitPlan, planDecisionAccess, planTone } from "./planRules";

interface PlanRow {
  id: number;
  planNumber: string;
  salesOrderId: number;
  salesOrderNumber?: string | null;
  status: string;
  shortageValue: string;
  approvalLevel: number;
  createdByName: string | null;
  submittedBy: number | null;
  createdAt: string;
}
interface PlanDetail extends PlanRow {
  notes: string | null;
  decisionNote: string | null;
  decidedByName: string | null;
  snapshot: {
    plan: Array<{ productName: string; requestedQty: string; allocation: { fromStock: string; toProduction: string }; purchaseShortages: Array<{ materialName: string; shortageQty: string }> }>;
  };
}

const val = (e: Event) => (e.target as HTMLInputElement).value;
const statusLabel = (s: string) => t(`opc.pl.st.${s}` as CopyKey);

/** الخطط المحفوظة: قايمة، تفاصيل، إرسال للاعتماد، واعتماد/رفض حسب المستوى. */
export function OperationsPlans({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useQuery((signal) => api.get<PlanRow[]>("/operations-center/plans", { signal, query: status ? { status } : {} }), [status]);
  const rows = Array.isArray(list.data) ? list.data : [];
  const columns: Column<PlanRow>[] = [
    { key: "no", header: t("opc.pl.col.no"), cell: (r) => <strong>{r.planNumber}</strong>, mobile: "title" },
    { key: "order", header: t("opc.pl.col.order"), cell: (r) => r.salesOrderNumber ?? String(r.salesOrderId), mobile: "hide" },
    { key: "value", header: t("opc.pl.col.value"), cell: (r) => formatMoney(Number(r.shortageValue)), numeric: true },
    { key: "level", header: t("opc.pl.col.level"), cell: (r) => t(`opc.pl.lv.${r.approvalLevel}` as CopyKey), mobile: "hide" },
    { key: "st", header: t("opc.col.status"), cell: (r) => <StatusPill tone={planTone(r.status)}>{statusLabel(r.status)}</StatusPill> },
    { key: "when", header: t("opc.tr.col.when"), cell: (r) => formatRelative(r.createdAt), mobile: "hide" },
  ];
  return (
    <>
      <div class="opc-toolbar">
        <Select
          aria-label={t("opc.col.status")}
          value={status}
          options={[{ value: "", label: t("opc.pl.st.all") }, { value: "draft", label: statusLabel("draft") }, { value: "submitted", label: statusLabel("submitted") }, { value: "approved", label: statusLabel("approved") }, { value: "rejected", label: statusLabel("rejected") }]}
          onChange={(e) => setStatus(val(e))}
        />
      </div>
      <p class="opc-muted">{t("opc.pl.note")}</p>
      {list.error ? <InlineAlert tone="danger" title={t("opc.err")}>{list.error.message}</InlineAlert> : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("opc.pl.title")} loading={list.loading} onRowClick={(r) => setOpenId(r.id)} empty={<EmptyState title={t("opc.pl.empty")} description={t("opc.pl.emptyBody")} compact />} />
      {openId !== null ? (
        <PlanDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={async () => {
            await list.refetch();
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function PlanDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void | Promise<void> }) {
  const act = useAct();
  const me = staffUser();
  const [note, setNote] = useState("");
  const q = useQuery((signal) => api.get<PlanDetail>(`/operations-center/plans/${id}`, { signal }), [id]);
  const p = q.data;
  const actor = { role: me?.role ?? "", userId: me?.id ?? 0 };
  const access = p ? planDecisionAccess(p, actor) : { approve: false, reject: false, needsNote: false };
  const canSubmit = p ? canSubmitPlan(p, actor) : false;

  const run = async (url: string, body: unknown, done: CopyKey) => {
    const ok = await act.run(async () => {
      await api.post<unknown>(url, body);
      return true;
    }, t(done));
    if (ok) {
      setNote("");
      await q.refetch();
      await onChanged();
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={p ? p.planNumber : t("opc.pl.loading")}
      footer={
        p ? (
          <div class="opc-foot">
            {canSubmit ? <Button icon={CircleCheck} loading={act.busy} onClick={() => void run(`/operations-center/plans/${id}/submit`, {}, p.approvalLevel === 0 ? "opc.pl.autoDone" : "opc.pl.submitDone")}>{p.approvalLevel === 0 ? t("opc.pl.autoBtn") : t("opc.pl.submitBtn")}</Button> : null}
            {access.approve ? <Button icon={CircleCheck} loading={act.busy} disabled={access.needsNote && note.trim().length < 3} onClick={() => void run(`/operations-center/plans/${id}/approve`, { note: note.trim() }, "opc.pl.approveDone")}>{t("opc.pl.approveBtn")}</Button> : null}
            {access.reject ? <Button variant="secondary" loading={act.busy} disabled={note.trim().length < 3} onClick={() => void run(`/operations-center/plans/${id}/reject`, { note: note.trim() }, "opc.pl.rejectDone")}>{t("opc.pl.rejectBtn")}</Button> : null}
          </div>
        ) : undefined
      }
    >
      {q.loading || !p ? <Skeleton lines={5} /> : (
        <div class="opc-stack">
          <div class="opc-hrow">
            <StatusPill tone={planTone(p.status)}>{statusLabel(p.status)}</StatusPill>
            <span class="opc-muted">{t("opc.pl.value", { v: formatMoney(Number(p.shortageValue)), l: t(`opc.pl.lv.${p.approvalLevel}` as CopyKey) })}</span>
          </div>
          {p.status === "submitted" && !access.approve && !access.reject ? <InlineAlert tone="info">{t("opc.pl.waiting", { l: t(`opc.pl.lv.${p.approvalLevel}` as CopyKey) })}</InlineAlert> : null}
          {p.decisionNote ? <InlineAlert tone="info" title={p.decidedByName ?? undefined}>{p.decisionNote}</InlineAlert> : null}
          <ul class="opc-plan">
            {p.snapshot.plan.map((line) => (
              <li key={line.productName}>
                <div class="opc-hrow">
                  <strong>{line.productName}</strong>
                  <span class="opc-muted">{t("opc.plan.requested", { n: formatNumber(Number(line.requestedQty)) })}</span>
                  <StatusPill tone="success">{t("opc.plan.stock", { n: formatNumber(Number(line.allocation.fromStock)) })}</StatusPill>
                  <StatusPill tone="brand">{t("opc.plan.prod", { n: formatNumber(Number(line.allocation.toProduction)) })}</StatusPill>
                </div>
                {line.purchaseShortages.length ? (
                  <ul class="opc-lines">
                    {line.purchaseShortages.map((s) => <li key={s.materialName}>{t("opc.plan.short", { name: s.materialName, n: formatNumber(Number(s.shortageQty)) })}</li>)}
                  </ul>
                ) : <span class="opc-muted">{t("opc.plan.mats.ok")}</span>}
              </li>
            ))}
          </ul>
          {access.approve || access.reject ? (
            <Field label={t("opc.pl.note.label")} hint={access.needsNote ? t("opc.pl.note.need") : t("opc.pl.note.hint")}>
              <Textarea value={note} onInput={(e) => setNote(val(e))} maxLength={500} />
            </Field>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
