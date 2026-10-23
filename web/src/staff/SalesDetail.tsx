import { useState } from "preact/hooks";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, ConfirmDialog, Drawer, InlineAlert, Skeleton, StatusPill, Timeline, useToast, type TimelineItem } from "../design/components";
import { Ban, Pencil, Printer, Trash } from "../design/icons";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "../lib/format";
import { useAct } from "../admin/act";
import { printInvoice } from "./salesPrint";
import { STATUS_TONE, allowedNext, isOverdue, isSalesStatus, overdueDays, primaryNext, stockEffects, type SalesOrder, type SalesStatus } from "./salesCore";

export const statusLabel = (s: string) => (isSalesStatus(s) ? t(`sales.status.${s}` as CopyKey) : s);
export const statusTone = (s: string) => (isSalesStatus(s) ? STATUS_TONE[s] : "neutral");

const FLOW: SalesStatus[] = ["draft", "confirmed", "shipped", "paid"];
const POS: Record<string, number> = { draft: 0, confirmed: 1, shipped: 2, paid: 3 };

/** مسار الفاتورة كتايم لاين: اللي خلص، الحالي، والجاي. */
export function flowItems(o: Pick<SalesOrder, "status" | "createdAt" | "updatedAt">): TimelineItem[] {
  const cur = POS[o.status];
  const out: TimelineItem[] = [];
  if (o.status === "pending_approval") {
    out.push({ id: "draft", title: t("sales.flow.draft"), meta: o.createdAt ? formatDateTime(o.createdAt) : undefined, tone: "success" });
    out.push({ id: "pending", title: t("sales.flow.pending_approval"), meta: o.updatedAt ? formatDateTime(o.updatedAt) : undefined, tone: "warn" });
    return out;
  }
  for (const s of FLOW) {
    const p = POS[s]!;
    if (o.status === "cancelled") {
      if (s === "draft") out.push({ id: s, title: t("sales.flow.draft"), meta: o.createdAt ? formatDateTime(o.createdAt) : undefined, tone: "success" });
      continue;
    }
    const done = cur !== undefined && p < cur;
    const now = p === cur;
    out.push({
      id: s,
      title: t(`sales.flow.${s}` as CopyKey),
      meta: now ? (o.updatedAt ? formatDateTime(o.updatedAt) : undefined) : s === "draft" && o.createdAt ? formatDateTime(o.createdAt) : !done ? t("sales.flow.next") : undefined,
      tone: done ? "success" : now ? "brand" : "neutral",
    });
  }
  if (o.status === "cancelled") out.push({ id: "cancelled", title: t("sales.flow.cancelled"), meta: o.updatedAt ? formatDateTime(o.updatedAt) : undefined, tone: "danger" });
  return out;
}

export interface SalesDetailProps {
  id: number;
  role: string;
  customerName: (contactId: number | null) => string;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (o: SalesOrder) => void;
}

export function SalesDetail({ id, role, customerName, onClose, onChanged, onEdit }: SalesDetailProps) {
  const q = useQuery((signal) => api.get<SalesOrder>(`/sales/${id}`, { signal }), [id]);
  const toast = useToast();
  const act = useAct();
  const [move, setMove] = useState<SalesStatus | null>(null);
  const [del, setDel] = useState(false);
  const o = q.data;

  const isOnline = o?.channel === "website";
  const sellerOnline = role === "online_seller";
  const canMove = !!o && allowedNext(o.status).length > 0;
  const canEdit = !!o && !isOnline && !sellerOnline && (o.status === "draft" || o.status === "confirmed");
  const canDelete = !!o && o.status !== "pending_approval" && (isOnline ? role === "chairman" : !sellerOnline);
  const next = o ? primaryNext(o.status) : null;
  const overdue = !!o && isOverdue(o);

  const doMove = async () => {
    if (!o || !move) return;
    const r = await act.run(() => api.patch<SalesOrder>(`/sales/${o.id}`, { status: move }));
    if (!r) return;
    toast({ tone: "success", message: r.status === "pending_approval" && move !== "pending_approval" ? t("sales.moved.approval") : t("sales.moved", { status: statusLabel(r.status) }) });
    setMove(null);
    onChanged();
    void q.refetch();
  };
  const doDelete = async () => {
    if (!o) return;
    const ok = await act.run(async () => {
      await api.delete<unknown>(`/sales/${o.id}`);
      return true;
    }, t("sales.deleted"));
    if (!ok) return;
    setDel(false);
    onChanged();
    onClose();
  };
  const print = () => {
    if (o && !printInvoice(o, customerName(o.contactId), statusLabel(o.status))) toast({ tone: "warn", message: t("sales.print.blocked") });
  };
  const effects = o && move ? stockEffects(o.status, move) : [];
  const moveDesc = o && move
    ? [
        t("sales.move.desc", { n: o.orderNumber, total: formatMoney(Number(o.total)) }),
        effects.length ? `${t("sales.move.effect")} ${effects.map((e) => t(`sales.effect.${e}` as CopyKey)).join(t("sales.move.sep"))}.` : t("sales.move.effect.none"),
        move === "confirmed" || move === "shipped" || move === "paid" ? t("sales.move.approval") : "",
        move === "cancelled" ? t("sales.move.cancel.warn") : "",
      ]
        .filter(Boolean)
        .join(" ")
    : undefined;

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={o ? t("sales.detail.title", { n: o.orderNumber }) : t("sales.detail.loading")}
        footer={
          o ? (
            <div class="sales-foot">
              {next && canMove ? <Button onClick={() => setMove(next)}>{t(`sales.act.${next}` as CopyKey)}</Button> : null}
              {canEdit ? <Button variant="secondary" icon={Pencil} onClick={() => onEdit(o)}>{t("sales.act.edit")}</Button> : null}
              <Button variant="secondary" icon={Printer} onClick={print}>{t("sales.act.print")}</Button>
              {allowedNext(o.status).includes("cancelled") ? <Button variant="ghost" icon={Ban} onClick={() => setMove("cancelled")}>{t("sales.act.cancelled")}</Button> : null}
              {canDelete ? <Button variant="ghost" icon={Trash} onClick={() => setDel(true)}>{t("sales.act.delete")}</Button> : null}
            </div>
          ) : undefined
        }
      >
        {q.loading && !o ? <Skeleton lines={6} /> : null}
        {q.error && !o ? (
          <InlineAlert tone="danger" title={t("sales.detail.err")} action={<Button variant="secondary" size="sm" onClick={() => void q.refetch()}>{t("sales.retry")}</Button>} />
        ) : null}
        {o ? (
          <div class="sales-detail">
            <div class="sales-detail__pills">
              <StatusPill tone={statusTone(o.status)}>{statusLabel(o.status)}</StatusPill>
              <StatusPill tone="neutral">{t(`sales.channel.${o.channel}` as CopyKey)}</StatusPill>
              {overdue ? <StatusPill tone="danger" pulse>{t("sales.overdue", { n: overdueDays(o) })}</StatusPill> : null}
            </div>
            {o.status === "pending_approval" ? <InlineAlert tone="warn">{t("sales.pending.note")}</InlineAlert> : null}
            {overdue ? <InlineAlert tone="danger">{t("sales.overdue.note", { n: overdueDays(o) })}</InlineAlert> : null}
            {isOnline ? <InlineAlert tone="info">{t("sales.readonly.website")}</InlineAlert> : null}

            <dl class="sales-facts">
              <div><dt>{t("sales.detail.customer")}</dt><dd>{customerName(o.contactId)}</dd></div>
              <div><dt>{t("sales.col.date")}</dt><dd>{formatDate(o.date)}</dd></div>
              <div><dt>{t("sales.col.due")}</dt><dd>{o.dueDate ? formatDate(o.dueDate) : "—"}</dd></div>
              {o.notes ? <div class="sales-facts__wide"><dt>{t("sales.detail.notes")}</dt><dd>{o.notes}</dd></div> : null}
            </dl>

            <h3 class="sales-h">{t("sales.detail.flow")}</h3>
            <Timeline items={flowItems(o)} />

            <h3 class="sales-h">{t("sales.detail.items")}</h3>
            {o.items && o.items.length ? (
              <div class="sales-items" role="region" aria-label={t("sales.detail.items")} tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t("sales.item.desc")}</th>
                      <th scope="col" class="is-num">{t("sales.item.qty")}</th>
                      <th scope="col" class="is-num">{t("sales.item.price")}</th>
                      <th scope="col" class="is-num">{t("sales.item.total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.items.map((i, k) => (
                      <tr key={i.id ?? k}>
                        <td>{i.description}</td>
                        <td class="is-num">{formatNumber(Number(i.qty))}</td>
                        <td class="is-num">{formatMoney(Number(i.unitPrice))}</td>
                        <td class="is-num">{formatMoney(Number(i.total))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p class="sales-muted">{t("sales.detail.items.none")}</p>
            )}
            <div class="sales-sum">
              <span>{t("sales.total")}</span>
              <strong>{formatMoney(Number(o.total))}</strong>
            </div>
          </div>
        ) : null}
      </Drawer>
      <ConfirmDialog
        open={move !== null}
        onClose={() => setMove(null)}
        onConfirm={doMove}
        loading={act.busy}
        danger={move === "cancelled"}
        title={move ? t("sales.move.title", { status: statusLabel(move) }) : ""}
        description={moveDesc}
        confirmLabel={move ? t(`sales.act.${move}` as CopyKey) : undefined}
      />
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={doDelete} loading={act.busy} danger title={o ? t("sales.delete.title", { n: o.orderNumber }) : ""} description={t("sales.delete.desc")} confirmLabel={t("sales.act.delete")} />
    </>
  );
}
