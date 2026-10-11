import { t } from "../../copy";
import { Drawer, InlineAlert, Skeleton, Tabs, Button } from "../../design/components";
import { navigate } from "../../app/router";
import { useQuery } from "../../api/hooks";
import { api } from "../api";
import { StatusBadge } from "../parts";
import type { CompanyDetail } from "../types";
import { ChatTab, LogTab, OrdersTab, OverviewTab, SecurityTab, SettingsTab } from "./CompanyTabs";
import { TeamTab } from "./TeamTab";

export const TAB_IDS = ["overview", "team", "orders", "chat", "security", "settings", "log"] as const;

export function CompanyDrawer({ id, tab, search, onClose, onListChanged }: { id: number; tab: string; search: string; onClose: () => void; onListChanged: () => void }) {
  const q = useQuery((signal) => api.get<CompanyDetail>(`/portal-companies/${id}`, { signal }), [id]);
  const d = q.data;
  const reload = async () => {
    await q.refetch();
    onListChanged();
  };
  const active = (TAB_IDS as readonly string[]).includes(tab) ? tab : "overview";
  const props = d ? { d, reload, onListChanged } : null;
  const tabs = props
    ? [
        { id: "overview", label: t("a.tab.overview"), panel: <OverviewTab {...props} /> },
        { id: "team", label: t("a.tab.team"), badge: d!.company.pendingJoin || undefined, panel: <TeamTab d={d!} reload={reload} /> },
        { id: "orders", label: t("a.tab.orders"), panel: <OrdersTab {...props} /> },
        { id: "chat", label: t("a.tab.chat"), panel: <ChatTab {...props} /> },
        { id: "security", label: t("a.tab.security"), panel: <SecurityTab {...props} /> },
        { id: "settings", label: t("a.tab.settings"), panel: <SettingsTab {...props} /> },
        { id: "log", label: t("a.tab.log"), panel: <LogTab {...props} /> },
      ]
    : [];
  return (
    <Drawer open onClose={onClose} title={d?.company.companyName ?? t("common.loading")} description={d ? undefined : undefined}>
      {q.error && !d ? (
        <InlineAlert tone="danger" title={t("a.err.load")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>}>
          {q.error.message}
        </InlineAlert>
      ) : null}
      {!d && !q.error ? <div class="ad-stack"><Skeleton height={32} /><Skeleton height={120} /><Skeleton height={200} /></div> : null}
      {d ? (
        <div class="ad-stack">
          <div><StatusBadge status={d.company.status} /></div>
          <Tabs tabs={tabs} value={active} onChange={(tid) => navigate(`/admin/portal-customers/${id}/${tid}${search}`, { replace: true })} label={t("a.tabs.label")} />
        </div>
      ) : null}
    </Drawer>
  );
}
