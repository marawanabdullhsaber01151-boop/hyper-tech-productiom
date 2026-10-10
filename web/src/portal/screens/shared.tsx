import { t, type CopyKey } from "../../copy";
import { Button, InlineAlert, Skeleton } from "../../design/components";
import type { ApiError } from "../../api/client";
import type { OrderItem, RollupStatus } from "../types";
import type { Tone } from "../../design/components";

export function LoadError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <InlineAlert tone="danger" title={t("p.err.load")} action={<Button size="sm" variant="secondary" onClick={onRetry}>{t("common.retry")}</Button>}>
      {error.message}
    </InlineAlert>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div class="pt-list" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={84} radius="var(--r-md)" />
      ))}
    </div>
  );
}

export const ROLLUP_TONE: Record<RollupStatus, Tone> = {
  pending_review: "info",
  in_progress: "brand",
  all_completed: "success",
  needs_attention: "warn",
  all_cancelled: "danger",
};
export const rollupLabel = (s: RollupStatus) => t(`p.orders.status.${s}` as CopyKey);

/** الخطوة الحالية من خط الزمن اللي السيرفر بيرجّعه. */
export function currentStepLabel(item: OrderItem): string {
  const cur = item.timeline.find((s) => s.state === "current") ?? [...item.timeline].reverse().find((s) => s.state === "reached");
  return cur?.label ?? item.workflowStatus;
}

export const readQty = (qty: string) => {
  const n = Number(qty);
  return Number.isFinite(n) ? n : 0;
};
