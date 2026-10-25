import { useState } from "preact/hooks";
import { api } from "../admin/api";
import { useAct } from "../admin/act";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, ConfirmDialog, Dialog, Drawer, Field, InlineAlert, Input, Skeleton, StatusPill, useToast } from "../design/components";
import { Ban, Check, Package, Pencil, Printer, Send, Undo2 } from "../design/icons";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import { printPo } from "./purchasePrint";
import { PO_TONE, allowedMoves, canEditOrder, canReceiveOrder, isPoStatus, lateDays, primaryMove, receiptCheck, remaining, type PoFull, type PoStatus } from "./purchasingCore";

export const poStatusLabel = (s: string) => (isPoStatus(s) ? t(`po.status.${s}` as CopyKey) : s);
export const poStatusTone = (s: string) => (isPoStatus(s) ? PO_TONE[s] : "neutral");
const n3 = (v: string | number) => formatNumber(Number(v) || 0);
const val = (e: Event) => (e.target as HTMLInputElement).value;

const MOVE_ICON: Partial<Record<PoStatus, typeof Send>> = { pending_approval: Send, approved: Check, draft: Undo2, sent: Send, cancelled: Ban };
const MOVE_LABEL: Record<string, CopyKey> = { pending_approval: "po.act.submit", approved: "po.act.approve", draft: "po.act.reject", sent: "po.act.send", cancelled: "po.act.cancel" };
const MOVE_DESC: Record<string, CopyKey> = { pending_approval: "po.move.desc.submit", approved: "po.move.desc.approve", draft: "po.move.desc.reject", sent: "po.move.desc.send", cancelled: "po.move.cancel.note" };

export interface PurchaseDetailProps {
  id: number;
  role: string;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (o: PoFull) => void;
}

export function PurchaseDetail({ id, role, onClose, onChanged, onEdit }: PurchaseDetailProps) {
  const q = useQuery((signal) => api.get<PoFull>(`/purchases/${id}`, { signal }), [id]);
  const toast = useToast();
  const act = useAct();
  const [move, setMove] = useState<PoStatus | null>(null);
  const [reason, setReason] = useState("");
  const [reasonErr, setReasonErr] = useState(false);
  const [receive, setReceive] = useState(false);
  const o = q.data;
  const moves = o ? allowedMoves(o.status, role) : [];
  const primary = o ? primaryMove(o.status, role) : null;
  const late = o ? lateDays(o) : 0;

  const refresh = () => {
    onChanged();
    void q.refetch();
  };
  const doMove = async () => {
    if (!o || !move) return;
    if (move === "cancelled" && !reason.trim()) {
      setReasonErr(true);
      return;
    }
    const r = await act.run(() => api.post<PoFull>(`/purchases/${o.id}/status`, { status: move, reason: move === "cancelled" ? reason.trim() : undefined }));
    if (!r) return;
    toast({ tone: "success", message: t("po.moved", { status: poStatusLabel(r.status) }) });
    setMove(null);
    setReason("");
    setReasonErr(false);
    refresh();
  };
  const print = () => {
    if (o && !printPo(o, poStatusLabel(o.status))) toast({ tone: "warn", message: t("sales.print.blocked") });
  };
  const prices = o?.total !== undefined;

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={o ? t("po.detail.title", { n: o.poNumber }) : t("po.detail.loading")}
        footer={
          o ? (
            <div class="po-foot">
              {primary ? <Button icon={MOVE_ICON[primary]} onClick={() => setMove(primary)}>{t(MOVE_LABEL[primary]!)}</Button> : null}
              {canReceiveOrder(o.status, role) ? <Button icon={Package} onClick={() => setReceive(true)}>{t("po.act.receive")}</Button> : null}
              {canEditOrder(o.status, role) ? <Button variant="secondary" icon={Pencil} onClick={() => onEdit(o)}>{t("po.act.edit")}</Button> : null}
              {moves.includes("draft") ? <Button variant="secondary" icon={Undo2} onClick={() => setMove("draft")}>{t("po.act.reject")}</Button> : null}
              <Button variant="secondary" icon={Printer} onClick={print}>{t("po.act.print")}</Button>
              {moves.includes("cancelled") ? <Button variant="ghost" icon={Ban} onClick={() => setMove("cancelled")}>{t("po.act.cancel")}</Button> : null}
            </div>
          ) : undefined
        }
      >
        {q.loading && !o ? <Skeleton lines={6} /> : null}
        {q.error && !o ? <InlineAlert tone="danger" title={t("po.detail.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("po.retry")}</Button>} /> : null}
        {o ? (
          <div class="po-detail">
            <div class="po-pills">
              <StatusPill tone={poStatusTone(o.status)}>{poStatusLabel(o.status)}</StatusPill>
              {late > 0 ? <StatusPill tone="danger" pulse>{t("po.late", { n: late })}</StatusPill> : null}
            </div>
            {o.status === "draft" ? <InlineAlert tone="info">{t("po.draft.note")}</InlineAlert> : null}
            {o.status === "pending_approval" ? <InlineAlert tone="warn">{t("po.pending.note")}</InlineAlert> : null}
            {o.status === "cancelled" && o.cancelReason ? <InlineAlert tone="danger">{t("po.cancelled.note", { why: o.cancelReason })}</InlineAlert> : null}
            <dl class="po-facts">
              <div><dt>{t("po.detail.supplier")}</dt><dd>{o.supplierName ?? "—"}</dd></div>
              <div><dt>{t("po.detail.expected")}</dt><dd>{o.expectedDate ? formatDate(o.expectedDate) : "—"}</dd></div>
              <div><dt>{t("po.detail.created")}</dt><dd>{o.createdByName ?? "—"}</dd></div>
              {prices ? <div><dt>{t("po.detail.total")}</dt><dd>{formatMoney(Number(o.total))}</dd></div> : null}
              {o.notes ? <div class="po-facts__wide"><dt>{t("po.detail.notes")}</dt><dd>{o.notes}</dd></div> : null}
            </dl>
            <h3 class="po-h">{t("po.detail.items")}</h3>
            <div class="po-items">
              <table>
                <thead>
                  <tr>
                    <th>{t("po.item.name")}</th>
                    <th class="is-num">{t("po.item.qty")}</th>
                    <th class="is-num">{t("po.item.got")}</th>
                    {prices ? <th class="is-num">{t("po.item.price")}</th> : null}
                    {prices ? <th class="is-num">{t("po.item.total")}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {o.items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.description}</td>
                      <td class="is-num">{n3(i.qty)} {i.unit ?? ""}</td>
                      <td class="is-num">{n3(i.receivedQty)}</td>
                      {prices ? <td class="is-num">{formatMoney(Number(i.unitPrice ?? 0))}</td> : null}
                      {prices ? <td class="is-num">{formatMoney(Number(i.qty) * Number(i.unitPrice ?? 0))}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Drawer>

      {o && move && move !== "cancelled" ? (
        <ConfirmDialog open loading={act.busy} onClose={() => setMove(null)} onConfirm={() => void doMove()} title={t("po.move.title", { act: t(MOVE_LABEL[move]!) })} description={t(MOVE_DESC[move]!)} confirmLabel={t(MOVE_LABEL[move]!)} />
      ) : null}
      {o && move === "cancelled" ? (
        <Dialog
          open
          size="sm"
          onClose={() => {
            setMove(null);
            setReasonErr(false);
          }}
          title={t("po.move.title", { act: t("po.act.cancel") })}
          description={t("po.move.cancel.note")}
          footer={
            <>
              <Button variant="ghost" onClick={() => setMove(null)}>{t("common.cancel")}</Button>
              <Button loading={act.busy} onClick={() => void doMove()}>{t("po.act.cancel")}</Button>
            </>
          }
        >
          <Field label={t("po.move.cancel.reason")} required error={reasonErr ? t("po.move.cancel.err") : null}>
            <Input value={reason} onInput={(e) => setReason(val(e))} />
          </Field>
        </Dialog>
      ) : null}
      {o && receive ? <ReceiveDialog order={o} onClose={() => setReceive(false)} onDone={() => { setReceive(false); refresh(); }} /> : null}
    </>
  );
}

function ReceiveDialog({ order, onClose, onDone }: { order: PoFull; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [input, setInput] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState("");
  const [tried, setTried] = useState(false);
  const chk = receiptCheck(order.items, input);
  const open = order.items.filter((i) => remaining(i) > 0);
  const save = async () => {
    setTried(true);
    if (chk.none || Object.keys(chk.errors).length) return;
    const r = await act.run(() => api.post<PoFull>(`/purchases/${order.id}/receive`, { lines: chk.lines, notes: notes.trim() || undefined }), t("po.rc.done"));
    if (r) onDone();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("po.rc.title", { n: order.poNumber })}
      description={t("po.rc.desc")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} onClick={() => void save()}>{t("po.rc.save")}</Button>
        </>
      }
    >
      <div class="po-ed">
        {tried && chk.none ? <InlineAlert tone="danger">{t("po.rc.err.none")}</InlineAlert> : null}
        <ul class="po-rows">
          {open.map((i) => (
            <li key={i.id} class="po-row">
              <div class="po-row__main po-row__main--rc">
                <div>
                  <strong>{i.description}</strong>
                  <div class="po-muted">{t("po.rc.remaining", { r: n3(remaining(i)), unit: i.unit ?? "" })}</div>
                </div>
                <Field label={t("po.rc.qty")} error={tried && chk.errors[i.id] ? t(chk.errors[i.id] === "over" ? "po.rc.err.over" : "po.rc.err.qty") : null}>
                  <Input inputMode="decimal" value={input[i.id] ?? ""} onInput={(e) => setInput((x) => ({ ...x, [i.id]: val(e) }))} />
                </Field>
              </div>
            </li>
          ))}
        </ul>
        <Field label={t("po.rc.notes")} optional>
          <Input value={notes} onInput={(e) => setNotes(val(e))} />
        </Field>
      </div>
    </Dialog>
  );
}
