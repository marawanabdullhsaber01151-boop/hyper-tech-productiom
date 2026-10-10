import { useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Button, Card, ConfirmDialog, EmptyState, Field, Icon, IconButton, InlineAlert, Select, Textarea, useToast } from "../../design/components";
import { CircleCheck, Minus, Plus, Trash } from "../../design/icons";
import { Link, navigate } from "../../app/router";
import { useMutation } from "../../api/hooks";
import { formatNumber } from "../../lib/format";
import { api } from "../api";
import { can } from "../session";
import { cartPieces, clearCartLocal, loadCart, removeFromCart, setCartQty, useCart } from "../cart";
import type { CartItem } from "../types";
import { ApiError } from "../../api/client";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

function Line({ item }: { item: CartItem }) {
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const qty = Number(item.qty);
  const run = (p: Promise<unknown>) => p.catch((e: ApiError) => toast({ tone: "danger", message: e.message }));
  const commit = () => {
    const n = Math.round(Number(draft));
    setDraft(null);
    if (Number.isFinite(n) && n >= 1 && n !== qty) void run(setCartQty(item.recipeId, n, "set"));
  };
  return (
    <Card class="pt-line">
      <div>
        <div class="pt-line__name">{item.productName}</div>
        <div class="pt-muted pt-ltr">{item.productCode}</div>
        {!item.available ? <InlineAlert tone="warn">{t("p.cart.unavailable")}</InlineAlert> : null}
      </div>
      <div class="pt-line__ctrl">
        <IconButton icon={Minus} size="sm" label={t("p.cart.dec", { name: item.productName })} disabled={qty <= 1} onClick={() => void run(setCartQty(item.recipeId, qty - 1, "set"))} />
        <input
          class="ht-control ht-control--ltr"
          type="number"
          inputMode="numeric"
          min={1}
          aria-label={t("p.cart.qtyOf", { name: item.productName })}
          value={draft ?? String(qty)}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        />
        <IconButton icon={Plus} size="sm" label={t("p.cart.inc", { name: item.productName })} onClick={() => void run(setCartQty(item.recipeId, qty + 1, "set"))} />
        <IconButton icon={Trash} size="sm" variant="danger" label={t("p.cart.remove", { name: item.productName })} onClick={() => void run(removeFromCart(item.recipeId))} />
      </div>
    </Card>
  );
}

export function Cart() {
  const cart = useCart();
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("normal");
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [sent, setSent] = useState<string | null>(null);
  const pieces = cartPieces(cart.items);
  const blocked = cart.items.some((i) => !i.available);

  const send = useMutation(async () => {
    const r = await api.post<{ batchRef: string }>("/portal/orders", {
      items: cart.items.map((i) => ({ bomRecipeId: i.recipeId, qty: String(Number(i.qty)), orderUnit: "piece" as const })),
      priority,
      notes: notes.trim() || null,
      idempotencyKey: key,
    });
    await clearCartLocal();
    await loadCart().catch(() => undefined);
    setKey(crypto.randomUUID());
    setConfirm(false);
    setSent(r.batchRef);
  });

  if (sent) {
    return (
      <div class="pt-stack pt-success">
        <span class="pt-success__ico">
          <Icon icon={CircleCheck} size={32} />
        </span>
        <h1 class="pt-page-title">{t("p.cart.success.title")}</h1>
        <span class="pt-muted">{t("p.cart.success.ref")}</span>
        <span class="pt-ref">{sent}</span>
        <p class="pt-muted">{t("p.cart.success.body")}</p>
        <div class="pt-row">
          <Button onClick={() => navigate("/portal/orders")}>{t("p.cart.success.orders")}</Button>
          <Button variant="secondary" onClick={() => navigate("/portal/products")}>
            {t("p.cart.success.more")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div class="pt-page-head">
        <h1 class="pt-page-title">{t("p.cart.title")}</h1>
        {cart.items.length ? <span class="pt-muted">{t("p.cart.total", { n: formatNumber(cart.items.length), pieces: formatNumber(pieces) })}</span> : null}
      </div>
      {cart.items.length === 0 ? (
        <EmptyState title={t("p.cart.empty")} description={t("p.cart.emptyBody")} action={<Link to="/portal/products">{t("p.home.browse")}</Link>} />
      ) : (
        <>
          <div class="pt-list" aria-live="polite">
            {cart.items.map((i) => (
              <Line key={i.id} item={i} />
            ))}
          </div>
          <Card class="pt-stack" pad>
            <Field label={t("p.cart.priority")}>
              <Select value={priority} options={PRIORITIES.map((p) => ({ value: p, label: t(`p.cart.pr.${p}` as CopyKey) }))} onChange={(e) => setPriority((e.currentTarget as HTMLSelectElement).value as (typeof PRIORITIES)[number])} />
            </Field>
            <Field label={t("p.cart.notes")} hint={t("p.cart.notesHint")} optional>
              <Textarea value={notes} maxLength={1000} onInput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)} />
            </Field>
          </Card>
          {!can("orders.create") ? <InlineAlert tone="warn">{t("p.cart.noPermission")}</InlineAlert> : null}
          <div class="pt-sticky-bar">
            <span class="pt-muted">{t("p.cart.total", { n: formatNumber(cart.items.length), pieces: formatNumber(pieces) })}</span>
            <Button size="lg" disabled={blocked || !can("orders.create")} onClick={() => setConfirm(true)}>
              {t("p.cart.review")}
            </Button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => void send.mutate(undefined)}
        loading={send.loading}
        title={t("p.cart.confirmTitle")}
        description={t("p.cart.confirmBody", { n: formatNumber(cart.items.length), pieces: formatNumber(pieces) })}
        confirmLabel={t("p.cart.send")}
      />
      {send.error ? (
        <InlineAlert tone="danger">
          {send.error.message}
          {send.error.code === "MEMBER_LIMIT_EXCEEDED" ? ` ${t("p.cart.limit")}` : ""}
        </InlineAlert>
      ) : null}
    </>
  );
}
