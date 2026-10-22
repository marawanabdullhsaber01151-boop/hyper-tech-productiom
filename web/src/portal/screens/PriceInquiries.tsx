import { t } from "../../copy";
import { Button, Card, EmptyState, StatusPill } from "../../design/components";
import { navigate } from "../../app/router";
import { useQuery } from "../../api/hooks";
import { formatNumber, formatRelative } from "../../lib/format";
import { api } from "../api";
import type { PriceInquiry } from "../types";
import { ListSkeleton, LoadError } from "./shared";

/** طلبات الأسعار بتاعت العميل: اللي مستني رد، واللي اتردّ عليه بالسعر. */
export function PriceInquiries() {
  const q = useQuery((signal) => api.get<PriceInquiry[]>("/portal/price-inquiries", { signal }), []);
  const rows = q.data ?? [];
  return (
    <div class="pt-stack">
      {q.error ? <LoadError error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.loading && !q.data ? <ListSkeleton /> : null}
      {q.data && rows.length === 0 ? <EmptyState title={t("p.inq.empty")} description={t("p.inq.emptyBody")} /> : null}
      <div class="pt-list">
        {rows.map((r) => {
          const answered = r.status === "answered";
          return (
            <Card key={r.id} class="pt-stack" pad>
              <div class="pt-row pt-row--between">
                <strong>{t("p.inq.asked", { name: r.productName })}</strong>
                <StatusPill tone={answered ? "success" : "warn"} pulse={!answered}>{answered ? t("p.inq.answered") : t("p.inq.pending")}</StatusPill>
              </div>
              <span class="pt-muted">{t("p.inq.qty", { n: formatNumber(Number(r.requestedQty) || 0) })}</span>
              {answered ? <p class="pt-inq-price">{t("p.inq.price", { price: formatNumber(Number(r.finalPrice) || 0) })}</p> : null}
              <div class="pt-row pt-row--between">
                <span class="pt-muted">{t("p.inq.sent", { when: formatRelative(r.createdAt) })}</span>
                <Button size="sm" variant="secondary" onClick={() => navigate(`/portal/products?open=${r.bomRecipeId}`)}>{t("p.inq.open")}</Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
