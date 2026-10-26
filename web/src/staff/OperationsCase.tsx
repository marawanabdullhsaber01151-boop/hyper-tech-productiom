import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { ApiError } from "../api/client";
import { navigate } from "../app/router";
import { t, type CopyKey } from "../copy";
import { Button, ConfirmDialog, Dialog, Drawer, Field, InlineAlert, Input, Select, Skeleton, StatusPill, Textarea } from "../design/components";
import { CircleCheck, Pencil, Play, RefreshCw, Send, Workflow } from "../design/icons";
import { formatDate, formatNumber, formatRelative } from "../lib/format";
import { CaseStatusPill, PriorityPill, ReasonChips, RiskPill, wfLabel, wfTone } from "./OperationsParts";
import { PRIORITIES, parseRevisionReason, unresolvedFrom, type NextAction, type RiskLevel, type UnresolvedLine } from "./operationsCore";

interface CaseRec {
  id: number;
  caseNumber: string;
  salesOrderId: number;
  status: string;
  priority: string;
  dueDate: string | null;
  assignedTo: number | null;
  customerDisplayName: string | null;
  workflowOrderId: number | null;
  version: number;
}
interface Workspace {
  case: CaseRec;
  lines: Array<{ id: number; productNameSnapshot: string; orderedQty: string; baseUnit: string; packagingQty: string; packagingUnit: string; lineStatus: string }>;
  revisions: Array<{ revision: number; changeReason: string | null; changedByName: string | null; createdAt: string }>;
  salesOrder: { orderNumber: string; status: string; date: string; dueDate: string | null; notes: string | null; channel: string } | null;
  linkedOrders: Array<{ id: number; orderNumber: string; workflowStatus: string; productName: string; qty: string; unit: string; neededBy: string | null; claimedByName: string | null; bomRecipeId: number | null; splitSequence: number | null }>;
  requisitions: Array<{ id: number; materialName: string; shortageQty: string; status: string }>;
  risk: { level: RiskLevel; reasons: string[]; sla: { hours: number; limit: number } | null };
  nextAction: NextAction;
}
interface Plan {
  plan: Array<{
    salesOrderItemId: number;
    productName: string;
    requestedQty: string;
    allocation: { fromStock: string; toProduction: string };
    recipeId: number | null;
    requirements: Array<{ materialName: string; requiredQty: string; availableQty: string; shortageQty: string }>;
    purchaseShortages: Array<{ materialName: string; shortageQty: string }>;
  }>;
}
interface Staff {
  id: number;
  name: string;
}

const val = (e: Event) => (e.target as HTMLInputElement).value;
const num = (s: string) => formatNumber(Number(s));
const isPositive = (s: string) => Number(s) > 0;

type Dlg = null | "clarify" | "resume" | "edit" | "convert";

/** مساحة عمل الحالة: كل اللي يخص الحالة في مكان واحد، وزر واحد واضح للخطوة اللي بعدها. */
export function OperationsCase({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const act = useAct();
  const ws = useQuery((signal) => api.get<Workspace>(`/operations-center/cases/${id}/workspace`, { signal }), [id]);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [text, setText] = useState("");
  const [unresolved, setUnresolved] = useState<UnresolvedLine[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const data = ws.data;

  const refresh = async () => {
    await ws.refetch();
    onChanged();
  };
  const post = async (path: string, body: unknown, ok: string) => {
    const r = await act.run(async () => {
      await api.post<unknown>(path, body);
      return true;
    }, ok);
    if (r) await refresh();
    return !!r;
  };
  const closeDlg = () => {
    setDlg(null);
    setText("");
  };

  const savePlan = async () => {
    const r = await act.run(async () => {
      await api.post<{ id: number }>("/operations-center/plans", { salesOrderId: data!.case.salesOrderId, caseId: data!.case.id });
      return true;
    }, t("opc.plan.saved"));
    if (r) onChanged();
  };
  const loadPlan = async () => {
    if (!data) return;
    const r = await act.run(() => api.get<Plan>(`/operations-control/sales-orders/${data.case.salesOrderId}/plan`));
    if (r) setPlan(r);
  };

  /** act.run بيعرض أي خطأ كـToast؛ فبنلتقط رفض "مفيش وصفة" جوّه الدالة عشان نعرض البنود الناقصة بالاسم. */
  const doConvert = async () => {
    setUnresolved([]);
    const out = await act.run(async () => {
      try {
        await api.post<unknown>(`/operations/cases/${id}/convert`, {});
        return { ok: true as const };
      } catch (e) {
        if (e instanceof ApiError && e.code === "OPERATIONS_CONVERT_RECIPE_UNRESOLVED") return { ok: false as const, lines: unresolvedFrom(e.details), message: e.message };
        throw e;
      }
    });
    setDlg(null);
    if (!out) return;
    if (out.ok) {
      await refresh();
    } else {
      setUnresolved(out.lines);
    }
  };

  const primary = (c: Workspace) => {
    switch (c.nextAction) {
      case "start_validation":
        return <Button icon={Play} loading={act.busy} onClick={() => void post(`/operations-manager/cases/${id}/start-validation`, {}, t("opc.act.started"))}>{t("opc.next.start_validation")}</Button>;
      case "complete_validation":
        return <Button icon={CircleCheck} loading={act.busy} onClick={() => void post(`/operations-manager/cases/${id}/complete-validation`, {}, t("opc.act.validated"))}>{t("opc.next.complete_validation")}</Button>;
      case "resume_validation":
        return <Button icon={RefreshCw} onClick={() => setDlg("resume")}>{t("opc.next.resume_validation")}</Button>;
      case "convert":
        return <Button icon={Workflow} onClick={() => setDlg("convert")}>{t("opc.next.convert")}</Button>;
      default:
        return null;
    }
  };

  const canClarify = data && (data.case.status === "received" || data.case.status === "under_validation");
  const closed = data && ["converted", "cancelled", "completed", "closed"].includes(data.case.status);

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={data ? data.case.caseNumber : t("opc.case.loading")}
        footer={
          data ? (
            <div class="opc-foot">
              {primary(data)}
              {canClarify ? <Button variant="secondary" icon={Send} onClick={() => setDlg("clarify")}>{t("opc.clarify.btn")}</Button> : null}
              {!closed ? <Button variant="ghost" icon={Pencil} onClick={() => setDlg("edit")}>{t("opc.edit.btn")}</Button> : null}
            </div>
          ) : undefined
        }
      >
        {ws.error ? <InlineAlert tone="danger" title={t("opc.case.err")} action={<Button size="sm" variant="secondary" onClick={() => void ws.refetch()}>{t("common.retry")}</Button>}>{ws.error.message}</InlineAlert> : null}
        {!data && !ws.error ? <Skeleton height={220} radius="var(--r-md)" /> : null}
        {data ? (
          <div class="opc-case">
            <div class="opc-pills">
              <CaseStatusPill status={data.case.status} />
              <PriorityPill priority={data.case.priority} />
              <RiskPill level={data.risk.level} />
            </div>
            <ReasonChips reasons={data.risk.reasons} hours={data.risk.sla?.hours} limit={data.risk.sla?.limit} />

            {unresolved.length ? (
              <InlineAlert tone="danger" title={t("opc.convert.blocked")}>
                <ul class="opc-list">
                  {unresolved.map((u) => (
                    <li key={u.lineId}>{t(`opc.convert.${u.reason}` as CopyKey, { name: u.productName })}</li>
                  ))}
                </ul>
              </InlineAlert>
            ) : null}

            <dl class="opc-facts">
              <div><dt>{t("opc.f.customer")}</dt><dd>{data.case.customerDisplayName ?? "—"}</dd></div>
              <div>
                <dt>{t("opc.f.sale")}</dt>
                <dd>
                  <button type="button" class="opc-link" onClick={() => navigate(`/staff/sales?open=${data.case.salesOrderId}`)}>{data.salesOrder?.orderNumber ?? `#${data.case.salesOrderId}`}</button>
                </dd>
              </div>
              <div><dt>{t("opc.f.due")}</dt><dd>{data.case.dueDate ? formatDate(data.case.dueDate) : "—"}</dd></div>
              <div><dt>{t("opc.f.channel")}</dt><dd>{data.salesOrder?.channel ?? "—"}</dd></div>
              {data.salesOrder?.notes ? <div class="opc-facts__wide"><dt>{t("opc.f.notes")}</dt><dd>{data.salesOrder.notes}</dd></div> : null}
            </dl>

            <h3 class="opc-h">{t("opc.lines")}</h3>
            <ul class="opc-lines">
              {data.lines.map((l) => (
                <li key={l.id}>
                  <strong>{l.productNameSnapshot}</strong>
                  <span class="opc-muted">{num(l.orderedQty)} {l.baseUnit}{isPositive(l.packagingQty) ? ` | ${num(l.packagingQty)} ${l.packagingUnit}` : ""}</span>
                </li>
              ))}
            </ul>

            <div class="opc-hrow">
              <h3 class="opc-h">{t("opc.plan.title")}</h3>
              <span class="opc-hrow">
                {plan ? <Button size="sm" loading={act.busy} onClick={() => void savePlan()}>{t("opc.plan.save")}</Button> : null}
                <Button size="sm" variant="secondary" loading={act.busy} onClick={() => void loadPlan()}>{plan ? t("opc.plan.reload") : t("opc.plan.run")}</Button>
              </span>
            </div>
            <p class="opc-muted">{t("opc.plan.note")}</p>
            {plan ? (
              <ul class="opc-plan">
                {plan.plan.map((p) => {
                  const short = p.purchaseShortages.filter((s) => isPositive(s.shortageQty));
                  const noRecipe = isPositive(p.allocation.toProduction) && p.recipeId === null;
                  return (
                    <li key={p.salesOrderItemId}>
                      <div class="opc-plan__head">
                        <strong>{p.productName}</strong>
                        <span class="opc-muted">{t("opc.plan.requested", { n: num(p.requestedQty) })}</span>
                      </div>
                      <div class="opc-plan__split">
                        <StatusPill tone="success">{t("opc.plan.stock", { n: num(p.allocation.fromStock) })}</StatusPill>
                        <StatusPill tone={isPositive(p.allocation.toProduction) ? "brand" : "neutral"}>{t("opc.plan.prod", { n: num(p.allocation.toProduction) })}</StatusPill>
                        {noRecipe ? <StatusPill tone="danger">{t("opc.plan.norecipe")}</StatusPill> : null}
                      </div>
                      {short.length ? (
                        <ul class="opc-plan__short">
                          {short.map((s) => (
                            <li key={s.materialName}>{t("opc.plan.short", { name: s.materialName, n: num(s.shortageQty) })}</li>
                          ))}
                        </ul>
                      ) : isPositive(p.allocation.toProduction) && !noRecipe ? (
                        <span class="opc-muted">{t("opc.plan.mats.ok")}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {data.linkedOrders.length ? (
              <>
                <h3 class="opc-h">{t("opc.orders")}</h3>
                <ul class="opc-lines">
                  {data.linkedOrders.map((o) => (
                    <li key={o.id}>
                      <strong>{o.orderNumber}</strong>
                      <span class="opc-muted">{o.productName} | {num(o.qty)} {o.unit}</span>
                      <StatusPill tone={wfTone(o.workflowStatus)}>{wfLabel(o.workflowStatus)}</StatusPill>
                      <OrderEvents orderId={o.id} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {data.requisitions.length ? (
              <>
                <h3 class="opc-h">{t("opc.reqs")}</h3>
                <ul class="opc-lines">
                  {data.requisitions.map((r) => (
                    <li key={r.id}>
                      <strong>{r.materialName}</strong>
                      <span class="opc-muted">{t("opc.req.short", { n: num(r.shortageQty) })}</span>
                      <StatusPill tone={r.status === "pending_operations" ? "warn" : "success"}>{t(r.status === "pending_operations" ? "opc.req.pending" : r.status === "ordered" ? "opc.req.ordered" : "opc.req.confirmed")}</StatusPill>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <h3 class="opc-h">{t("opc.history")}</h3>
            <ol class="opc-timeline">
              {data.revisions.map((r) => {
                const p = parseRevisionReason(r.changeReason);
                const known = ["sales_order_received", "validation_started", "validation_completed", "sales_clarification_requested", "validation_resumed", "details_updated", "converted_to_production"].includes(p.code);
                return (
                  <li key={r.revision}>
                    <strong>{known ? t(`opc.rev.${p.code}` as CopyKey) : p.code || t("opc.rev.unknown")}</strong>
                    {p.note ? <span class="opc-note">{p.note}</span> : null}
                    <span class="opc-muted">{r.changedByName ?? "—"} | {formatRelative(r.createdAt)}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </Drawer>

      <Dialog
        open={dlg === "clarify" || dlg === "resume"}
        onClose={closeDlg}
        title={t(dlg === "resume" ? "opc.resume.title" : "opc.clarify.title")}
        description={t(dlg === "resume" ? "opc.resume.desc" : "opc.clarify.desc")}
        footer={
          <>
            <Button variant="ghost" onClick={closeDlg}>{t("common.cancel")}</Button>
            <Button
              loading={act.busy}
              disabled={text.trim().length < 3}
              onClick={async () => {
                const isResume = dlg === "resume";
                const ok = await post(
                  `/operations-manager/cases/${id}/${isResume ? "resume-validation" : "request-sales-clarification"}`,
                  isResume ? { note: text.trim() } : { reason: text.trim() },
                  t(isResume ? "opc.resume.done" : "opc.clarify.done"),
                );
                if (ok) closeDlg();
              }}
            >
              {t(dlg === "resume" ? "opc.resume.send" : "opc.clarify.send")}
            </Button>
          </>
        }
      >
        <Field label={t(dlg === "resume" ? "opc.resume.label" : "opc.clarify.label")} required hint={t("opc.min3")}>
          <Textarea value={text} onInput={(e) => setText(val(e))} maxLength={1000} />
        </Field>
      </Dialog>

      {dlg === "edit" && data ? <EditDialog rec={data.case} onClose={closeDlg} onSaved={async () => { closeDlg(); await refresh(); }} /> : null}

      <ConfirmDialog
        open={dlg === "convert"}
        onClose={() => setDlg(null)}
        onConfirm={() => void doConvert()}
        title={t("opc.convert.title")}
        description={t("opc.convert.desc", { n: data?.lines.length ?? 0 })}
        confirmLabel={t("opc.convert.confirm")}
        loading={act.busy}
      />
    </>
  );
}

function EditDialog({ rec, onClose, onSaved }: { rec: CaseRec; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const act = useAct();
  const staff = useQuery((signal) => api.get<Staff[]>("/operations-manager/staff", { signal }), []);
  const [assignee, setAssignee] = useState(rec.assignedTo ? String(rec.assignedTo) : "");
  const [priority, setPriority] = useState(rec.priority);
  const [due, setDue] = useState(rec.dueDate ?? "");

  const save = async () => {
    const body: Record<string, unknown> = { expectedVersion: rec.version };
    const nextAssignee = assignee ? Number(assignee) : null;
    if (nextAssignee !== rec.assignedTo) body.assignedTo = nextAssignee;
    if (priority !== rec.priority) body.priority = priority;
    const nextDue = due || null;
    if (nextDue !== rec.dueDate) body.dueDate = nextDue;
    if (Object.keys(body).length === 1) return onClose();
    const ok = await act.run(async () => {
      await api.patch<unknown>(`/operations-manager/cases/${rec.id}`, body);
      return true;
    }, t("opc.edit.done"));
    if (ok) await onSaved();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("opc.edit.title")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} onClick={() => void save()}>{t("common.save")}</Button>
        </>
      }
    >
      <div class="opc-form">
        <Field label={t("opc.f.assignee")}>
          <Select value={assignee} options={[{ value: "", label: t("opc.f.unassigned") }, ...(staff.data ?? []).map((s) => ({ value: String(s.id), label: s.name }))]} onChange={(e) => setAssignee(val(e))} />
        </Field>
        <Field label={t("opc.f.priority")}>
          <Select value={priority} options={PRIORITIES.map((p) => ({ value: p, label: t(`opc.pr.${p}` as CopyKey) }))} onChange={(e) => setPriority(val(e))} />
        </Field>
        <Field label={t("opc.f.due")} optional>
          <Input type="date" value={due} onInput={(e) => setDue(val(e))} />
        </Field>
      </div>
    </Dialog>
  );
}

interface OrderEvent {
  id: number;
  internalStatus: string;
  actorName: string | null;
  automatic: boolean;
  cause: string | null;
  details: string | null;
  createdAt: string;
}

/** سجل أحداث أمر الإنتاج: بيتحمّل عند الطلب بس. */
function OrderEvents({ orderId }: { orderId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="opc-events">
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? t("opc.ev.hide") : t("opc.ev.show")}</Button>
      {open ? <OrderEventsList orderId={orderId} /> : null}
    </div>
  );
}

function OrderEventsList({ orderId }: { orderId: number }) {
  const ev = useQuery((signal) => api.get<OrderEvent[]>(`/operations-control/orders/${orderId}/events`, { signal }), [orderId]);
  const rows = Array.isArray(ev.data) ? ev.data : [];
  if (ev.loading) return <Skeleton height={48} />;
  if (ev.error) return <InlineAlert tone="danger" title={t("opc.err")}>{ev.error.message}</InlineAlert>;
  if (!rows.length) return <p class="opc-muted">{t("opc.ev.empty")}</p>;
  return (
    <ol class="opc-timeline">
      {rows.map((e) => (
        <li key={e.id}>
          <strong>{wfLabel(e.internalStatus)}</strong>
          <span class="opc-muted">{e.automatic ? t("opc.ev.auto") : e.actorName ?? "—"} | {formatRelative(e.createdAt)}</span>
          {e.details || e.cause ? <span class="opc-muted">{e.details ?? e.cause}</span> : null}
        </li>
      ))}
    </ol>
  );
}
