import { useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Button, Dialog, Drawer, Field, Input, InlineAlert, Skeleton, StatusPill, Textarea, Timeline, type Tone } from "../../design/components";
import { useQuery } from "../../api/hooks";
import { formatDateTime, formatMoney } from "../../lib/format";
import { api } from "../api";
import { useAct } from "../act";
import type { OrdDetail, OrdLine } from "../types";
import { OrdStatusPill } from "./PortalOrders";

const KNOWN = ["submitted", "confirmed", "rejected", "claimed", "cancelled", "cancelled_late"];
const evTone = (k: string): Tone => (k === "confirmed" || k === "claimed" ? "success" : k === "rejected" || k === "cancelled_late" ? "danger" : "neutral");

type Dlg = null | { kind: "confirm" } | { kind: "reject" } | { kind: "cancel"; line: OrdLine };

export function OrderDrawer({ batchRef, onClose, onChanged }: { batchRef: string; onClose: () => void; onChanged: () => void }) {
  const { run, busy } = useAct();
  const ref = encodeURIComponent(batchRef);
  const q = useQuery((signal) => api.get<OrdDetail>(`/portal-admin/orders/${ref}`, { signal }), [batchRef]);
  const d = q.data;
  const pending = d?.batch.status === "pending";

  const [dlg, setDlg] = useState<Dlg>(null);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");

  const close = () => {
    setDlg(null);
    setText("");
    setReply("");
  };
  const reload = async () => {
    await q.refetch();
    onChanged();
  };
  const live = (d?.items ?? []).filter((l) => l.stage !== "cancelled");
  const priceOf = (l: OrdLine) => prices[l.id] ?? l.referenceUnitPrice ?? "";
  const pricesOk = live.length > 0 && live.every((l) => Number(priceOf(l)) > 0);

  const confirm = async () => {
    const items = live.map((l) => ({ workflowOrderId: l.id, unitPrice: String(Number(priceOf(l))) }));
    const res = await run(() => api.post(`/portal-orders/${ref}/confirm`, { items, replyMessage: reply.trim() || undefined }), t("a.po.confirm.done"));
    if (res !== undefined) {
      close();
      await reload();
    }
  };
  const reject = async () => {
    const res = await run(() => api.post(`/portal-orders/${ref}/reject`, { reason: text.trim(), replyMessage: reply.trim() || undefined }), t("a.po.reject.done"));
    if (res !== undefined) {
      close();
      await reload();
    }
  };
  const claim = async (l: OrdLine) => {
    const res = await run(() => api.post(`/portal-orders/${l.id}/claim`, {}), t("a.po.claim.done"));
    if (res !== undefined) await reload();
  };
  const cancelLine = async (l: OrdLine) => {
    const res = await run(() => api.post(`/portal-orders/${l.id}/cancel`, { reason: text.trim() }), t("a.po.cancel.done"));
    if (res !== undefined) {
      close();
      await reload();
    }
  };

  return (
    <Drawer open onClose={onClose} title={t("a.po.d.title", { ref: batchRef })} description={d?.company?.companyName}>
      {q.error && !d ? (
        <InlineAlert tone="danger" title={t("a.po.err.load")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert>
      ) : null}
      {!d && !q.error ? <div class="ad-stack"><Skeleton height={32} /><Skeleton height={160} /><Skeleton height={160} /></div> : null}
      {d ? (
        <div class="ad-stack">
          <OrdStatusPill r={d.batch} />
          {d.invoice ? <p class="ad-muted">{t("a.po.d.invoice", { n: d.invoice.orderNumber })}</p> : null}
          {d.review?.replyMessage ? <p class="ad-muted">{t("a.po.d.reply", { reply: d.review.replyMessage })}</p> : null}
          {d.review?.rejectReason ? <p class="ad-muted">{t("a.po.d.reason", { reason: d.review.rejectReason })}</p> : null}

          {pending ? (
            <div class="ad-row">
              <Button onClick={() => setDlg({ kind: "confirm" })} disabled={!live.length}>{t("a.po.d.confirm")}</Button>
              <Button variant="danger" onClick={() => setDlg({ kind: "reject" })}>{t("a.po.d.reject")}</Button>
            </div>
          ) : null}

          <section class="ad-stack" aria-labelledby="po-lines">
            <h3 id="po-lines" class="ad-sub">{t("a.po.d.lines")}</h3>
            {d.items.map((l) => (
              <div key={l.id} class="ad-match">
                <strong>{l.productName}</strong>
                <span class="ad-muted">{t("a.po.d.qty", { qty: l.qty, unit: l.unit ?? "" })}{l.referenceUnitPrice ? ` · ${t("a.po.d.refPrice", { price: formatMoney(Number(l.referenceUnitPrice)) })}` : ""}</span>
                {l.submittedBy ? <span class="ad-muted">{t("a.po.d.by", { name: l.submittedBy })}</span> : null}
                <div class="ad-pillrow">
                  <StatusPill tone={l.stage === "cancelled" ? "neutral" : "info"}>{t(`a.po.stage.${l.stage}` as CopyKey)}</StatusPill>
                  {l.cancelStage ? <StatusPill tone="warn">{t("a.po.lateCancel")}</StatusPill> : null}
                </div>
                {l.cancelReason ? <span class="ad-muted">{t("a.po.d.reason", { reason: l.cancelReason })}</span> : null}
                {l.canClaim || l.canCancel ? (
                  <div class="ad-row">
                    {l.canClaim ? <Button size="sm" variant="secondary" loading={busy} onClick={() => void claim(l)}>{t("a.po.d.claim")}</Button> : null}
                    {l.canCancel ? <Button size="sm" variant="ghost" onClick={() => { setText(""); setDlg({ kind: "cancel", line: l }); }}>{t("a.po.d.cancelLine")}</Button> : null}
                  </div>
                ) : null}
              </div>
            ))}
          </section>

          <section class="ad-stack" aria-labelledby="po-hist">
            <h3 id="po-hist" class="ad-sub">{t("a.po.d.history")}</h3>
            <Timeline items={d.events.map((e, i) => ({ id: i, title: `${t(`a.po.ev.${KNOWN.includes(e.kind) ? e.kind : "submitted"}` as CopyKey)}${e.line ? ` — ${e.line}` : ""}`, meta: `${e.actor ?? ""} · ${formatDateTime(e.at)}`, body: e.note ?? undefined, tone: evTone(e.kind) }))} />
          </section>
        </div>
      ) : null}

      <Dialog open={dlg?.kind === "confirm"} onClose={close} title={t("a.po.confirm.title")} description={t("a.po.confirm.body")}
        footer={<><Button variant="ghost" onClick={close}>{t("common.cancel")}</Button><Button loading={busy} disabled={!pricesOk} onClick={() => void confirm()}>{t("a.po.confirm.go")}</Button></>}>
        <div class="ad-stack">
          {live.map((l) => (
            <Field key={l.id} label={`${l.productName} — ${t("a.po.confirm.price")}`}>
              <Input type="number" inputMode="decimal" min="0" value={priceOf(l)} onInput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; setPrices((p) => ({ ...p, [l.id]: v })); }} />
            </Field>
          ))}
          <Field label={t("a.po.confirm.reply")}>
            <Textarea rows={2} value={reply} onInput={(e) => setReply((e.currentTarget as HTMLTextAreaElement).value)} />
          </Field>
        </div>
      </Dialog>

      <Dialog open={dlg?.kind === "reject" || dlg?.kind === "cancel"} onClose={close}
        title={dlg?.kind === "cancel" ? t("a.po.cancel.title") : t("a.po.reject.title")}
        footer={<><Button variant="ghost" onClick={close}>{t("common.cancel")}</Button>
          {dlg?.kind === "cancel"
            ? <Button variant="danger" loading={busy} disabled={text.trim().length < 2} onClick={() => void cancelLine(dlg.line)}>{t("a.po.cancel.go")}</Button>
            : <Button variant="danger" loading={busy} disabled={text.trim().length < 2} onClick={() => void reject()}>{t("a.po.reject.go")}</Button>}</>}>
        <Field label={dlg?.kind === "cancel" ? t("a.po.cancel.reason") : t("a.po.reject.reason")} required>
          <Textarea rows={3} value={text} onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} />
        </Field>
      </Dialog>
    </Drawer>
  );
}
