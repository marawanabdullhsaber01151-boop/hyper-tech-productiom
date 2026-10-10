import { useEffect, useState } from "preact/hooks";
import { t } from "../../copy";
import { Button, Card, EmptyState } from "../../design/components";
import { navigate } from "../../app/router";
import { useQuery } from "../../api/hooks";
import { formatRelative } from "../../lib/format";
import { api } from "../api";
import { notifStore, refreshUnread } from "../notifications";
import type { Paged, PortalNotification } from "../types";
import { ListSkeleton, LoadError } from "./shared";

function target(n: PortalNotification): string | null {
  if (n.referenceType === "production_workflow") return "/portal/orders";
  if (n.referenceType === "portal_member") return "/portal/team";
  return null;
}

export function Notifications() {
  const q = useQuery((signal) => api.get<Paged<PortalNotification>>("/portal/notifications", { query: { limit: 50 }, signal }), []);
  const [items, setItems] = useState<PortalNotification[]>([]);
  useEffect(() => {
    if (q.data) setItems(q.data.data);
  }, [q.data]);

  const read = async (n: PortalNotification) => {
    if (!n.isRead) {
      setItems((l) => l.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      notifStore.set((s) => ({ unread: Math.max(0, s.unread - 1) }));
      await api.patch(`/portal/notifications/${n.id}/read`).catch(() => undefined);
    }
    const to = target(n);
    if (to) navigate(to);
  };
  const markAll = async () => {
    const unread = items.filter((n) => !n.isRead);
    setItems((l) => l.map((x) => ({ ...x, isRead: true })));
    await Promise.all(unread.map((n) => api.patch(`/portal/notifications/${n.id}/read`).catch(() => undefined)));
    void refreshUnread();
  };
  const unread = items.filter((n) => !n.isRead).length;
  return (
    <>
      <div class="pt-page-head">
        <h1 class="pt-page-title">{t("p.notif.title")}</h1>
        {unread ? (
          <Button size="sm" variant="secondary" onClick={() => void markAll()}>
            {t("p.notif.markAll")}
          </Button>
        ) : null}
      </div>
      {q.error ? <LoadError error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.loading && !q.data ? <ListSkeleton /> : null}
      {q.data && items.length === 0 ? <EmptyState title={t("p.notif.empty")} description={t("p.notif.emptyBody")} /> : null}
      {items.length ? (
        <Card pad={false} as="section">
          {items.map((n) => (
            <button key={n.id} type="button" class="pt-notif" data-unread={!n.isRead} onClick={() => void read(n)}>
              <span class="pt-notif__dot" aria-hidden="true" />
              <span>
                <span class="pt-notif__title">{n.title}</span>
                <span class="pt-notif__body" style={{ display: "block" }}>
                  {n.body}
                </span>
                <span class="pt-muted">{formatRelative(n.createdAt)}</span>
              </span>
            </button>
          ))}
        </Card>
      ) : null}
    </>
  );
}
