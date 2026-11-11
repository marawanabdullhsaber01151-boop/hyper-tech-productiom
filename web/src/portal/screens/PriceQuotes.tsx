import { useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Button, Card, ConfirmDialog, Dialog, EmptyState, Field, InlineAlert, StatusPill, Textarea, useToast } from "../../design/components";
import { navigate } from "../../app/router";
import { useMutation, useQuery } from "../../api/hooks";
import { formatDate, formatMoney, formatNumber } from "../../lib/format";
import { api } from "../api";
import { can } from "../session";
import type { PortalAgreement, PortalQuote } from "../types";
import { ListSkeleton, LoadError } from "./shared";

const tone = (s: PortalQuote["status"]) => (s === "sent" ? "info" : s === "ordered" ? "success" : s === "expired" ? "warn" : "neutral");

/** عروض الأسعار اللي وصلت للعميل: يطلب منها بنفس السعر بضغطة واحدة، أو يرفضها. */
export function PriceQuotes() {
  const q = useQuery((signal) => api.get<{ items: PortalQuote[] }>("/portal/price-quotes", { signal }), []);
  const ag = useQuery((signal) => api.get<{ items: PortalAgreement[] }>("/portal/price-agreements", { signal }), []);
  const toast = useToast();
  const [order, setOrder] = useState<PortalQuote | null>(null);
  const [decline, setDecline] = useState<{ quote: PortalQuote; reason: string } | null>(null);
  const canOrder = can("orders.create");
  const place = useMutation(async (quote: PortalQuote) => {
    const r = await api.post<{ batchRef: string }>("/portal/orders", {
      items: quote.lines.map((l) => ({ bomRecipeId: l.bomRecipeId, qty: String(Number(l.qty)), orderUnit: "piece" as const })),
      priority: "normal",
      notes: null,
      quoteId: quote.id,
      idempotencyKey: crypto.randomUUID(),
    });
    setOrder(null);
    toast({ tone: "success", message: t("p.qt.ordered") });
    navigate(`/portal/orders/${r.batchRef}`);
  });
  const reject = useMutation(async (arg: { quote: PortalQuote; reason: string }) => {
    await api.post(`/portal/price-quotes/${arg.quote.id}/decline`, { reason: arg.reason.trim() || undefined });
    setDecline(null);
    toast({ tone: "success", message: t("p.qt.declined") });
    await q.refetch();
  });
  const rows = q.data?.items ?? [];
  return (
    <div class="pt-stack">
      {q.error ? <LoadError error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.loading && !q.data ? <ListSkeleton /> : null}
      {(ag.data?.items.length ?? 0) > 0 ? (
        <Card class="pt-stack" pad>
          <strong>{t("p.ag.title")}</strong>
          <p class="pt-muted">{t("p.ag.hint")}</p>
          <ul class="pt-stack">
            {(ag.data?.items ?? []).map((a) => (
              <li key={a.id} class="pt-row pt-row--between">
                <span>{a.productName}</span>
                <span class="pt-muted">{t("p.ag.line", { price: formatMoney(Number(a.unitPrice)), from: formatDate(a.validFrom), until: formatDate(a.validUntil) })}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {q.data && rows.length === 0 ? <EmptyState title={t("p.qt.empty")} description={t("p.qt.emptyBody")} /> : null}
      <div class="pt-list">
        {rows.map((r) => (
          <Card key={r.id} class="pt-stack" pad>
            <div class="pt-row pt-row--between">
              <strong>{t("p.qt.number", { n: r.quoteNumber })}</strong>
              <StatusPill tone={tone(r.status)}>{t(`p.qt.status.${r.status}` as CopyKey)}</StatusPill>
            </div>
            <ul class="pt-stack">
              {r.lines.map((l) => (
                <li key={l.bomRecipeId} class="pt-row pt-row--between">
                  <span>{l.productName}</span>
                  <span class="pt-muted">{t("p.qt.line", { qty: formatNumber(Number(l.qty)), price: formatMoney(Number(l.unitPrice)) })}</span>
                </li>
              ))}
            </ul>
            <div class="pt-row pt-row--between">
              <strong>{t("p.qt.total", { total: formatMoney(Number(r.total)) })}</strong>
              <span class="pt-muted">{t("p.qt.valid", { date: formatDate(r.validUntil) })}</span>
            </div>
            {r.notes ? <p class="pt-muted">{r.notes}</p> : null}
            {r.status === "sent" ? (
              <div class="pt-row">
                <Button disabled={!canOrder} onClick={() => setOrder(r)}>{t("p.qt.order")}</Button>
                <Button variant="secondary" disabled={!canOrder} onClick={() => setDecline({ quote: r, reason: "" })}>{t("p.qt.decline")}</Button>
              </div>
            ) : null}
            {r.status === "sent" && !canOrder ? <InlineAlert tone="warn">{t("p.cart.noPermission")}</InlineAlert> : null}
            {r.status === "expired" ? <InlineAlert tone="warn">{t("p.qt.expiredNote")}</InlineAlert> : null}
            {r.status === "ordered" && r.batchRef ? <Button size="sm" variant="secondary" onClick={() => navigate(`/portal/orders/${r.batchRef}`)}>{t("p.qt.openOrder")}</Button> : null}
          </Card>
        ))}
      </div>
      <ConfirmDialog
        open={order !== null}
        onClose={() => setOrder(null)}
        onConfirm={() => { if (order) void place.mutate(order); }}
        loading={place.loading}
        title={t("p.qt.confirmTitle")}
        description={order ? t("p.qt.confirmBody", { n: order.quoteNumber, total: formatMoney(Number(order.total)) }) : ""}
        confirmLabel={t("p.qt.order")}
      />
      {place.error ? <InlineAlert tone="danger">{place.error.message}</InlineAlert> : null}
      <Dialog
        open={decline !== null}
        onClose={() => setDecline(null)}
        title={t("p.qt.declineTitle")}
        description={t("p.qt.declineBody")}
        size="sm"
        footer={<><Button variant="ghost" onClick={() => setDecline(null)}>{t("common.cancel")}</Button><Button loading={reject.loading} onClick={() => { if (decline) void reject.mutate(decline); }}>{t("p.qt.decline")}</Button></>}
      >
        <Field label={t("p.qt.declineReason")} optional>
          <Textarea value={decline?.reason ?? ""} maxLength={300} onInput={(e) => setDecline((d) => (d ? { ...d, reason: (e.target as HTMLTextAreaElement).value } : d))} />
        </Field>
      </Dialog>
      {reject.error ? <InlineAlert tone="danger">{reject.error.message}</InlineAlert> : null}
    </div>
  );
}
