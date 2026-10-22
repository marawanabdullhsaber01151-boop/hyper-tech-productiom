import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { t, type CopyKey } from "../copy";
import { Button, Drawer, EmptyState, IconButton, InlineAlert, Skeleton, Tabs } from "../design/components";
import { Bell } from "../design/icons";
import { formatNumber, formatRelative } from "../lib/format";
import { navHrefs, notificationTarget, ORDER_PAGES, pickPage } from "./commands";
import type { WorkflowOrder } from "./dashboardCore";
import { computeMyActions, hasActionList, type MyAction } from "./myActions";
import { openHref } from "./CommandPalette";
import type { NavResponse } from "./nav";
import { getShared } from "./sharedData";

interface Note {
  id: number;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  referenceType?: string | null;
  referenceId?: number | null;
}

const POLL_MS = 60_000;

/**
 * الجرس: عدّاد واحد (مطلوب مني + إشعارات غير مقروءة) ومركز إشعارات بتبويبين.
 * العدّاد بيتحدّث كل دقيقة والتبويب ظاهر، وعند الرجوع للتبويب. «مطلوب مني» بيتحسب بس للأدوار اللي ليها قايمة،
 * وبيستخدم الكاش المشترك فمفيش طلب أوامر الإنتاج بيتكرر مع اللوحة والبحث.
 */
export function NotificationCenter({ nav }: { nav: NavResponse | undefined }) {
  const me = staffUser();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("actions");
  const [unread, setUnread] = useState(0);
  const [actions, setActions] = useState<MyAction[]>([]);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState(false);
  const hrefs = useMemo(() => navHrefs(nav), [nav]);

  const refreshCounts = useCallback(async () => {
    if (!me) return;
    try {
      const r = await api.get<{ count?: number }>("/notifications/unread-count");
      setUnread(Number(r?.count) || 0);
    } catch {
      /* العدّاد بيفضل على آخر قيمة */
    }
    if (!hasActionList(me.role)) return;
    try {
      const access = await getShared<{ can?: Record<string, boolean> }>("/me/access", 300_000);
      if (access?.can?.productionWorkflowRead !== true) return setActions([]);
      const orders = await getShared<WorkflowOrder[]>("/production-workflow");
      setActions(Array.isArray(orders) ? computeMyActions(orders, { id: me.id, role: me.role }) : []);
    } catch {
      /* مش مهم: القايمة بتفضل على آخر قيمة */
    }
  }, [me?.id, me?.role]);

  const loadNotes = useCallback(async () => {
    setError(false);
    try {
      const list = await api.get<Note[]>("/notifications", { query: { limit: 30 } });
      setNotes(Array.isArray(list) ? list : []);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void refreshCounts();
    const id = setInterval(() => document.visibilityState === "visible" && void refreshCounts(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void refreshCounts();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshCounts]);

  useEffect(() => {
    if (!open) return;
    void refreshCounts();
    void loadNotes();
  }, [open]);

  const total = unread + actions.length;
  const ordersPage = pickPage(hrefs, ORDER_PAGES) ?? nav?.homeHref ?? null;

  const markAll = async () => {
    try {
      await api.patch("/notifications/read-all", {});
      setNotes((n) => (n ? n.map((x) => ({ ...x, isRead: true })) : n));
      setUnread(0);
    } catch {
      setError(true);
    }
  };
  const openNote = (n: Note) => {
    if (!n.isRead) {
      // تفاؤلي: بنعلّمه مقروء فورًا وبنفتح الصفحة من غير ما نستنى السيرفر؛ ولو الطلب فشل بيرجع زي ما كان
      setNotes((l) => (l ? l.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) : l));
      setUnread((u) => Math.max(0, u - 1));
      api.patch(`/notifications/${n.id}/read`, {}).catch(() => {
        setNotes((l) => (l ? l.map((x) => (x.id === n.id ? { ...x, isRead: false } : x)) : l));
        setUnread((u) => u + 1);
      });
    }
    const to = notificationTarget(n, nav);
    if (to) {
      setOpen(false);
      openHref(to);
    }
  };

  const actionsPanel =
    actions.length === 0 ? (
      <EmptyState title={t("staff.bell.actions.empty")} description={t("staff.bell.actions.emptyBody")} compact />
    ) : (
      <ul class="st-bell__list">
        {actions.slice(0, 30).map((a) => (
          <li key={a.order.id}>
            <button type="button" class="st-bell__item" disabled={!ordersPage} onClick={() => ordersPage && (setOpen(false), openHref(ordersPage))}>
              <span class="st-bell__title">{`${a.order.orderNumber} — ${a.order.productName}`}</span>
              <span class="st-bell__body">{t(`staff.bell.act.${a.kind}` as CopyKey)}</span>
              {a.order.qty !== null && Number.isFinite(Number(a.order.qty)) ? (
                <span class="st-bell__time">{t("staff.bell.qty", { qty: formatNumber(Number(a.order.qty)), unit: a.order.unit ?? "" })}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    );

  const notesPanel = error ? (
    <InlineAlert tone="danger" title={t("staff.bell.err")} action={<Button size="sm" variant="secondary" onClick={() => void loadNotes()}>{t("staff.bell.retry")}</Button>} />
  ) : notes === null ? (
    <div aria-busy="true">
      <Skeleton lines={3} height={48} />
    </div>
  ) : notes.length === 0 ? (
    <EmptyState title={t("staff.bell.notes.empty")} description={t("staff.bell.notes.emptyBody")} compact />
  ) : (
    <>
      {unread > 0 ? (
        <div class="st-bell__bar">
          <Button size="sm" variant="ghost" onClick={() => void markAll()}>{t("staff.bell.markAll")}</Button>
        </div>
      ) : null}
      <ul class="st-bell__list">
        {notes.map((n) => (
          <li key={n.id}>
            <button type="button" class={`st-bell__item${n.isRead ? "" : " st-bell__item--unread"}`} onClick={() => openNote(n)}>
              <span class="st-bell__title">{n.title}</span>
              <span class="st-bell__body">{n.body}</span>
              <span class="st-bell__time">{formatRelative(n.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <>
      <span class="st-bell">
        <IconButton icon={Bell} label={total > 0 ? t("staff.header.bellCount", { n: total }) : t("staff.header.bell")} aria-haspopup="dialog" onClick={() => setOpen(true)} />
        {total > 0 ? (
          <span class="st-bell__badge" aria-hidden="true">
            {total > 9 ? "9+" : total}
          </span>
        ) : null}
      </span>
      <Drawer open={open} onClose={() => setOpen(false)} title={t("staff.bell.title")} description={t("staff.bell.sub")}>
        <Tabs
          label={t("staff.bell.tabs")}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "actions", label: t("staff.bell.tab.actions"), badge: actions.length || undefined, panel: actionsPanel },
            { id: "notes", label: t("staff.bell.tab.notes"), badge: unread || undefined, panel: notesPanel },
          ]}
        />
      </Drawer>
    </>
  );
}
