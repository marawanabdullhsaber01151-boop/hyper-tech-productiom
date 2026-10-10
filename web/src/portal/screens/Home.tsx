import { t } from "../../copy";
import { Button, Card, EmptyState, InlineAlert } from "../../design/components";
import { Link, navigate } from "../../app/router";
import { useMutation, useQuery } from "../../api/hooks";
import { formatNumber } from "../../lib/format";
import { api } from "../api";
import { can, useAuth } from "../session";
import { useCart } from "../cart";
import type { ChannelsInfo, OrderBatch, Paged } from "../types";
import { BatchCard, reorderBatch } from "./Orders";
import { ListSkeleton, LoadError } from "./shared";

export function Home() {
  const auth = useAuth();
  const cart = useCart();
  const canOrders = can("orders.view_own") || can("orders.view_company");
  const orders = useQuery((signal) => (canOrders ? api.get<Paged<OrderBatch>>("/portal/my-orders", { query: { scope: "mine", limit: 3 }, signal }) : Promise.resolve(null)), []);
  const sec = useQuery((signal) => api.get<ChannelsInfo>("/portal/me/channels", { signal }).catch(() => null), []);
  const again = useMutation(async (b: OrderBatch) => {
    await reorderBatch(b);
    navigate("/portal/cart");
  });
  const unsecured = sec.data && sec.data.channels.filter((c) => c.verified).length === 0 && sec.data.recoveryCodesLeft === 0;
  const latest = orders.data?.data ?? [];

  return (
    <>
      <div class="pt-hello">
        <span class="pt-muted">{auth.customer?.companyName}</span>
        <h1 class="pt-hello__name">{t("p.home.hello", { name: auth.customer?.fullName?.split(" ")[0] ?? "" })}</h1>
      </div>
      <div class="pt-alerts">
        {auth.mustChangePassword ? (
          <InlineAlert tone="warn" title={t("p.mustChange.title")} action={<Button size="sm" onClick={() => navigate("/portal/account?tab=security")}>{t("p.mustChange.action")}</Button>}>
            {t("p.mustChange.body")}
          </InlineAlert>
        ) : null}
        {unsecured ? (
          <InlineAlert tone="info" title={t("p.secure.title")} action={<Button size="sm" variant="secondary" onClick={() => navigate("/portal/account?tab=security")}>{t("p.secure.action")}</Button>}>
            {t("p.secure.body")}
          </InlineAlert>
        ) : null}
        {cart.items.length > 0 && can("cart.use") ? (
          <InlineAlert tone="info" action={<Button size="sm" onClick={() => navigate("/portal/cart")}>{t("p.home.openCart")}</Button>}>
            {t("p.home.cartWaiting", { n: formatNumber(cart.items.length) })}
          </InlineAlert>
        ) : null}
      </div>
      {canOrders ? (
        <section class="pt-stack" aria-labelledby="latest-h">
          <div class="pt-row pt-row--between">
            <h2 id="latest-h">{t("p.home.latest")}</h2>
            <Link to="/portal/orders">{t("p.home.all")}</Link>
          </div>
          {orders.error ? <LoadError error={orders.error} onRetry={() => void orders.refetch()} /> : null}
          {orders.loading && !orders.data ? <ListSkeleton rows={2} /> : null}
          {orders.data && latest.length === 0 ? <EmptyState title={t("p.home.noOrders")} description={t("p.home.noOrdersBody")} action={<Button onClick={() => navigate("/portal/products")}>{t("p.home.browse")}</Button>} /> : null}
          <div class="pt-list">
            {latest.map((b) => (
              <div key={b.batchRef} class="pt-stack">
                <BatchCard b={b} onOpen={() => navigate(`/portal/orders/${encodeURIComponent(b.batchRef)}`)} />
                {can("cart.use") ? (
                  <Button size="sm" variant="secondary" loading={again.loading} onClick={() => void again.mutate(b)}>
                    {t("p.home.reorder")}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <Card class="pt-stack" pad>
          <Button onClick={() => navigate("/portal/products")}>{t("p.home.browse")}</Button>
        </Card>
      )}
    </>
  );
}
