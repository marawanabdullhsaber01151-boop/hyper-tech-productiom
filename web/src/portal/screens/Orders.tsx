import { useEffect, useState } from "preact/hooks";
import { t } from "../../copy";
import { Button, Card, Dialog, Drawer, EmptyState, Field, InlineAlert, Select, StatusPill, Textarea, Timeline, useToast } from "../../design/components";
import { navigate } from "../../app/router";
import { ApiError } from "../../api/client";
import { useMutation } from "../../api/hooks";
import { formatDate, formatDateTime, formatNumber } from "../../lib/format";
import { api } from "../api";
import { can } from "../session";
import { loadCart, setCartQty } from "../cart";
import type { OrderBatch, OrderItem, Paged } from "../types";
import { ListSkeleton, LoadError, ROLLUP_TONE, currentStepLabel, readQty, rollupLabel } from "./shared";

export async function reorderBatch(batch: OrderBatch): Promise<number> {
  let n = 0;
  for (const it of batch.items) {
    if (!it.bomRecipeId || it.workflowStatus === "cancelled") continue;
    const qty = Math.round(readQty(it.qty));
    if (qty < 1) continue;
    await setCartQty(it.bomRecipeId, qty, "add");
    n += 1;
  }
  await loadCart().catch(() => undefined);
  return n;
}

export function BatchCard({ b, onOpen }: { b: OrderBatch; onOpen: () => void }) {
  return (
    <Card class="pt-order">
      <div class="pt-order__head">
        <div>
          <button type="button" class="pt-order__ref" style={{ all: "unset", cursor: "pointer", fontWeight: 800 }} onClick={onOpen}>
            {t("p.orders.batch", { ref: b.batchRef })}
          </button>
          <div class="pt-muted">{formatDateTime(b.createdAt)}</div>
        </div>
        <StatusPill tone={ROLLUP_TONE[b.overallStatus]}>{rollupLabel(b.overallStatus)}</StatusPill>
      </div>
      <div class="pt-order__items">
        {b.items.slice(0, 3).map((i) => (
          <div key={i.id} class="pt-order__item">
            <span>{i.productName}</span>
            <span class="pt-muted">{t("p.orders.qty", { qty: formatNumber(readQty(i.qty)), unit: i.unit })}</span>
          </div>
        ))}
        {b.items.length > 3 ? <span class="pt-muted">{t("p.orders.items", { n: formatNumber(b.items.length) })}</span> : null}
      </div>
    </Card>
  );
}

function ItemBlock({ item, onCancel }: { item: OrderItem; onCancel: (i: OrderItem) => void }) {
  return (
    <div class="pt-stack">
      <div class="pt-order__item">
        <strong>{item.productName}</strong>
        <span class="pt-muted">{t("p.orders.qty", { qty: formatNumber(readQty(item.qty)), unit: item.unit })}</span>
      </div>
      <div class="pt-steps" aria-hidden="true">
        {item.timeline.map((s) => (
          <span key={s.key} class="pt-steps__dot" data-s={s.state} />
        ))}
      </div>
      <StatusPill tone={item.workflowStatus === "cancelled" ? "danger" : "brand"}>{currentStepLabel(item)}</StatusPill>
      {item.submittedBy ? <span class="pt-muted">{t("p.orders.by", { name: item.submittedBy.isMe ? t("p.orders.byMe") : (item.submittedBy.name ?? "") })}</span> : null}
      {item.suggestedDueDate ? <span class="pt-muted">{t("p.orders.due", { date: formatDate(item.suggestedDueDate) })}</span> : null}
      {item.rejection?.reason ? <InlineAlert tone="warn">{t("p.orders.reason", { reason: item.rejection.reason })}</InlineAlert> : null}
      <Timeline items={item.timeline.map((s) => ({ id: s.key, title: s.label, meta: s.at ? formatDateTime(s.at) : undefined, tone: s.state === "reached" ? "success" : s.state === "current" ? "brand" : "neutral" }))} />
      {item.canCancel ? (
        <Button variant="danger" size="sm" onClick={() => onCancel(item)}>
          {t("p.orders.cancel")}
        </Button>
      ) : null}
    </div>
  );
}

function BatchDrawer({ batch, onClose, onChanged }: { batch: OrderBatch | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [target, setTarget] = useState<OrderItem | null>(null);
  const [reason, setReason] = useState("");
  const cancel = useMutation(async () => {
    await api.post(`/portal/orders/${target!.id}/cancel`, { reason: reason.trim() || null });
    toast({ tone: "success", message: t("p.orders.cancelled") });
    setTarget(null);
    setReason("");
    onChanged();
  });
  const again = useMutation(async () => {
    await reorderBatch(batch!);
    toast({ tone: "success", message: t("p.orders.reordered") });
    navigate("/portal/cart");
  });
  return (
    <>
      <Drawer
        open={!!batch}
        onClose={onClose}
        title={batch ? t("p.orders.batch", { ref: batch.batchRef }) : t("p.orders.detail")}
        description={batch ? formatDateTime(batch.createdAt) : undefined}
        footer={
          batch && can("cart.use") ? (
            <Button loading={again.loading} onClick={() => void again.mutate(undefined)}>
              {t("p.orders.reorder")}
            </Button>
          ) : undefined
        }
      >
        {batch ? (
          <div class="pt-stack">
            <StatusPill tone={ROLLUP_TONE[batch.overallStatus]}>{rollupLabel(batch.overallStatus)}</StatusPill>
            {batch.review?.replyMessage ? (
              <InlineAlert tone="info" title={t("p.orders.reply")}>
                {batch.review.replyMessage}
              </InlineAlert>
            ) : null}
            {again.error ? <InlineAlert tone="danger">{again.error.message}</InlineAlert> : null}
            {batch.items.map((i) => (
              <Card key={i.id} class="pt-order">
                <ItemBlock item={i} onCancel={setTarget} />
              </Card>
            ))}
          </div>
        ) : null}
      </Drawer>
      <Dialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={t("p.orders.cancelTitle", { name: target?.productName ?? "" })}
        description={target?.lateCancel ? t("p.orders.cancelLate") : t("p.orders.cancelBody")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={cancel.loading} onClick={() => void cancel.mutate(undefined)}>
              {t("p.orders.cancel")}
            </Button>
          </>
        }
      >
        <Field label={t("p.orders.cancelReason")} optional>
          <Textarea value={reason} maxLength={500} onInput={(e) => setReason((e.currentTarget as HTMLTextAreaElement).value)} />
        </Field>
      </Dialog>
      {cancel.error ? <InlineAlert tone="danger">{cancel.error.message}</InlineAlert> : null}
    </>
  );
}

export function Orders({ openRef }: { openRef?: string }) {
  const company = can("orders.view_company");
  const [scope, setScope] = useState<"mine" | "all">(company ? "all" : "mine");
  const [pages, setPages] = useState<OrderBatch[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    api
      .get<Paged<OrderBatch>>("/portal/my-orders", { query: { scope, page, limit: 20 } })
      .then((r) => {
        if (dead) return;
        setPages((p) => (page === 1 ? r.data : [...p, ...r.data.filter((x) => !p.some((y) => y.batchRef === x.batchRef))]));
        setMore(r.pagination.hasMore);
        setError(null);
      })
      .catch((e: ApiError) => !dead && setError(e))
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [scope, page, tick]);

  const open = openRef ? (pages.find((b) => b.batchRef === openRef) ?? null) : null;
  return (
    <>
      <div class="pt-page-head">
        <h1 class="pt-page-title">{company ? t("p.orders.companyTitle") : t("p.orders.title")}</h1>
        {company ? (
          <Select
            aria-label={t("p.orders.scope.label")}
            value={scope}
            options={[
              { value: "all", label: t("p.orders.scope.all") },
              { value: "mine", label: t("p.orders.scope.mine") },
            ]}
            onChange={(e) => {
              setScope((e.currentTarget as HTMLSelectElement).value as "mine" | "all");
              setPage(1);
            }}
          />
        ) : null}
      </div>
      {error ? <LoadError error={error} onRetry={() => setTick((n) => n + 1)} /> : null}
      {loading && pages.length === 0 ? <ListSkeleton /> : null}
      {!loading && !error && pages.length === 0 ? <EmptyState title={t("p.orders.empty")} description={t("p.orders.emptyBody")} /> : null}
      <div class="pt-list">
        {pages.map((b) => (
          <BatchCard key={b.batchRef} b={b} onOpen={() => navigate(`/portal/orders/${encodeURIComponent(b.batchRef)}`)} />
        ))}
      </div>
      {more ? (
        <Button variant="secondary" loading={loading} onClick={() => setPage((p) => p + 1)}>
          {t("p.orders.more")}
        </Button>
      ) : null}
      {openRef && !open && !loading ? (
        <InlineAlert tone="info" action={<Button size="sm" variant="secondary" onClick={() => navigate("/portal/orders")}>{t("p.orders.back")}</Button>}>
          {t("p.orders.notFound")}
        </InlineAlert>
      ) : null}
      <BatchDrawer
        batch={open}
        onClose={() => navigate("/portal/orders")}
        onChanged={() => {
          setPage(1);
          setTick((n) => n + 1);
        }}
      />
    </>
  );
}
