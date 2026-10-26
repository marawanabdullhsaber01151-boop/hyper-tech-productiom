import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t } from "../copy";
import { Button, ConfirmDialog, DataTable, Dialog, EmptyState, Field, InlineAlert, Select, StatusPill, Textarea, type Column, type Tone } from "../design/components";
import { Check, Link2 } from "../design/icons";
import { formatDate, formatNumber, formatRelative } from "../lib/format";
import { PriorityPill, wfLabel, wfTone } from "./OperationsParts";

interface ProdOrder {
  id: number;
  orderNumber: string;
  productName: string;
  qty: string;
  unit: string;
  priority: string;
  neededBy: string | null;
  customerName: string | null;
  workflowStatus: string;
  claimedByName: string | null;
  createdAt: string;
}
interface Requisition {
  id: number;
  materialName: string;
  requiredQty: string;
  availableQty: string;
  shortageQty: string;
  status: string;
  reason: string;
  createdAt: string;
}
interface ExceptionRow {
  id: number;
  exceptionType: string;
  severity: string;
  title: string;
  resourceType: string;
  resourceId: number;
  createdAt: string;
}

const val = (e: Event) => (e.target as HTMLInputElement).value;
const num = (s: string) => formatNumber(Number(s));
const sevTone = (s: string): Tone => (s === "critical" || s === "high" ? "danger" : s === "warning" ? "warn" : "info");

/** الجزء ده فيه طابورين تشغيل: استلام أوامر الإنتاج، والاحتياجات (شراء) والاستثناءات. */
export function OperationsQueues({ part, onChanged }: { part: "claim" | "needs"; onChanged: () => void }) {
  return part === "claim" ? <ClaimQueue onChanged={onChanged} /> : (
    <div class="opc-stack">
      <Requisitions onChanged={onChanged} />
      <Exceptions onChanged={onChanged} />
    </div>
  );
}

function ClaimQueue({ onChanged }: { onChanged: () => void }) {
  const act = useAct();
  const [status, setStatus] = useState("awaiting_operations_claim");
  const [target, setTarget] = useState<ProdOrder | null>(null);
  const list = useQuery((signal) => api.get<ProdOrder[]>("/operations-manager/production-orders", { signal, query: { status } }), [status]);
  // السيرفر بيرجّع { data: [...] } والعميل بيفرده، فالنتيجة مصفوفة.
  const rows = Array.isArray(list.data) ? list.data : [];

  const claim = async () => {
    if (!target) return;
    const ok = await act.run(async () => {
      await api.post<unknown>(`/operations-manager/production-orders/${target.id}/claim`, {});
      return true;
    }, t("opc.claim.done", { no: target.orderNumber }));
    setTarget(null);
    if (ok) {
      await list.refetch();
      onChanged();
    }
  };

  const columns: Column<ProdOrder>[] = [
    { key: "no", header: t("opc.col.order"), cell: (r) => <strong>{r.orderNumber}</strong>, mobile: "title" },
    { key: "product", header: t("opc.col.product"), cell: (r) => r.productName },
    { key: "qty", header: t("opc.col.qty"), cell: (r) => `${num(r.qty)} ${r.unit}`, numeric: true },
    { key: "customer", header: t("opc.f.customer"), cell: (r) => r.customerName ?? "—", mobile: "hide" },
    { key: "priority", header: t("opc.f.priority"), cell: (r) => <PriorityPill priority={r.priority} />, mobile: "hide" },
    { key: "needed", header: t("opc.col.needed"), cell: (r) => (r.neededBy ? formatDate(r.neededBy) : "—"), mobile: "hide" },
    { key: "wait", header: t("opc.col.waiting"), cell: (r) => formatRelative(r.createdAt), mobile: "hide" },
    {
      key: "act",
      header: t("opc.col.action"),
      cell: (r) =>
        r.workflowStatus === "awaiting_operations_claim" ? (
          <Button size="sm" icon={Check} onClick={(e) => { e.stopPropagation(); setTarget(r); }}>{t("opc.claim.btn")}</Button>
        ) : (
          <StatusPill tone={wfTone(r.workflowStatus)}>{wfLabel(r.workflowStatus)}{r.claimedByName ? ` | ${r.claimedByName}` : ""}</StatusPill>
        ),
    },
  ];

  return (
    <>
      <div class="opc-toolbar">
        <Select aria-label={t("opc.col.status")} value={status} options={[{ value: "awaiting_operations_claim", label: t("opc.claim.f.waiting") }, { value: "claimed", label: t("opc.claim.f.claimed") }]} onChange={(e) => setStatus(val(e))} />
      </div>
      <p class="opc-muted">{t("opc.claim.note")}</p>
      {list.error ? <InlineAlert tone="danger" title={t("opc.err")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>}>{list.error.message}</InlineAlert> : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("opc.claim.caption")} loading={list.loading} empty={<EmptyState title={t("opc.claim.empty")} description={t("opc.claim.emptyBody")} compact />} />
      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={() => void claim()}
        title={t("opc.claim.title")}
        description={target ? t("opc.claim.desc", { no: target.orderNumber, name: target.productName }) : undefined}
        confirmLabel={t("opc.claim.btn")}
        loading={act.busy}
      />
    </>
  );
}

function Requisitions({ onChanged }: { onChanged: () => void }) {
  const act = useAct();
  const list = useQuery((signal) => api.get<Requisition[]>("/operations-control/purchase-requisitions", { signal }), []);
  const rows = (Array.isArray(list.data) ? list.data : []).filter((r) => r.status === "pending_operations");
  const confirm = async (r: Requisition) => {
    const ok = await act.run(async () => {
      await api.patch<unknown>(`/operations-control/purchase-requisitions/${r.id}/confirm`, {});
      return true;
    }, t("opc.req.confirmedToast", { name: r.materialName }));
    if (ok) {
      await list.refetch();
      onChanged();
    }
  };
  const columns: Column<Requisition>[] = [
    { key: "mat", header: t("opc.col.material"), cell: (r) => <strong>{r.materialName}</strong>, mobile: "title" },
    { key: "need", header: t("opc.col.required"), cell: (r) => num(r.requiredQty), numeric: true, mobile: "hide" },
    { key: "have", header: t("opc.col.available"), cell: (r) => num(r.availableQty), numeric: true, mobile: "hide" },
    { key: "short", header: t("opc.col.shortage"), cell: (r) => <StatusPill tone="danger">{num(r.shortageQty)}</StatusPill>, numeric: true },
    { key: "age", header: t("opc.col.waiting"), cell: (r) => formatRelative(r.createdAt), mobile: "hide" },
    { key: "act", header: t("opc.col.action"), cell: (r) => <Button size="sm" icon={Link2} loading={act.busy} onClick={() => void confirm(r)}>{t("opc.req.confirmBtn")}</Button> },
  ];
  return (
    <section class="opc-card">
      <h2 class="opc-h">{t("opc.reqs.title")}</h2>
      <p class="opc-muted">{t("opc.reqs.note")}</p>
      {list.error ? <InlineAlert tone="danger" title={t("opc.err")}>{list.error.message}</InlineAlert> : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("opc.reqs.title")} loading={list.loading} empty={<EmptyState title={t("opc.reqs.empty")} compact />} />
    </section>
  );
}

function Exceptions({ onChanged }: { onChanged: () => void }) {
  const list = useQuery((signal) => api.get<ExceptionRow[]>("/operations/exceptions", { signal, query: { status: "open" } }), []);
  const rows = Array.isArray(list.data) ? list.data : [];
  const [target, setTarget] = useState<ExceptionRow | null>(null);
  const columns: Column<ExceptionRow>[] = [
    { key: "title", header: t("opc.col.exception"), cell: (r) => <strong>{r.title}</strong>, mobile: "title" },
    { key: "type", header: t("opc.col.type"), cell: (r) => r.exceptionType, mobile: "hide" },
    { key: "sev", header: t("opc.col.severity"), cell: (r) => <StatusPill tone={sevTone(r.severity)}>{r.severity}</StatusPill> },
    { key: "age", header: t("opc.col.waiting"), cell: (r) => formatRelative(r.createdAt), mobile: "hide" },
    { key: "act", header: t("opc.col.action"), cell: (r) => <Button size="sm" variant="secondary" onClick={() => setTarget(r)}>{t("opc.exc.resolve")}</Button> },
  ];
  return (
    <section class="opc-card">
      <h2 class="opc-h">{t("opc.exc.title")}</h2>
      <p class="opc-muted">{t("opc.exc.note")}</p>
      {list.error ? <InlineAlert tone="danger" title={t("opc.err")}>{list.error.message}</InlineAlert> : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("opc.exc.title")} loading={list.loading} empty={<EmptyState title={t("opc.exc.empty")} compact />} />
      {target ? (
        <ResolveDialog
          row={target}
          onClose={() => setTarget(null)}
          onDone={async () => {
            setTarget(null);
            await list.refetch();
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

function ResolveDialog({ row, onClose, onDone }: { row: ExceptionRow; onClose: () => void; onDone: () => void | Promise<void> }) {
  const act = useAct();
  const [cause, setCause] = useState("");
  const [fix, setFix] = useState("");
  const valid = cause.trim().length >= 3 && fix.trim().length >= 3;
  const save = async () => {
    const ok = await act.run(async () => {
      await api.patch<unknown>(`/operations/exceptions/${row.id}/resolve`, { rootCause: cause.trim(), resolution: fix.trim() });
      return true;
    }, t("opc.exc.done"));
    if (ok) await onDone();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("opc.exc.dlg", { title: row.title })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} disabled={!valid} onClick={() => void save()}>{t("opc.exc.save")}</Button>
        </>
      }
    >
      <div class="opc-form">
        <Field label={t("opc.exc.cause")} required hint={t("opc.min3")}>
          <Textarea value={cause} onInput={(e) => setCause(val(e))} maxLength={500} />
        </Field>
        <Field label={t("opc.exc.fix")} required hint={t("opc.min3")}>
          <Textarea value={fix} onInput={(e) => setFix(val(e))} maxLength={500} />
        </Field>
      </div>
    </Dialog>
  );
}
