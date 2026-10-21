import { useState } from "preact/hooks";
import { ar, t, type CopyKey } from "../../copy";
import { Button, EmptyState, InlineAlert, Section, Skeleton, Switch, Tabs } from "../../design/components";
import { ArrowRight } from "../../design/icons";
import { Link } from "../../app/router";
import { useQuery } from "../../api/hooks";
import { api } from "../api";
import { useAct } from "../act";
import { SettingField } from "../SettingField";
import type { GlobalSettings, HistoryItem } from "../types";
import { HistoryList } from "./CompanyTabs";

/** الصفحات اللي ليها واجهة جديدة (كل صفحة بتتحول لوحدها). */
// صفحات الإدارة (العملاء/الانضمام/التفعيل/الطلبات/الشات) بقت واجهة واحدة جديدة بس ومفيش لها علم تشغيل. فاضل: بوابة العميل.
export const V2_PAGES = ["portal"];

export function PortalSettingsPage() {
  const { run, busy } = useAct();
  const data = useQuery((signal) => api.get<GlobalSettings>("/portal-admin/settings", { signal }), []);
  const hist = useQuery((signal) => api.get<{ items: HistoryItem[] }>("/portal-admin/settings-history", { signal }), []);
  const [err, setErr] = useState<{ key: string; msg: string } | null>(null);
  const [group, setGroup] = useState<string>("");

  const put = async (key: string, body: unknown) => {
    setErr(null);
    try {
      await api.put(`/portal-admin/settings/${encodeURIComponent(key)}`, body);
      await Promise.all([data.refetch(), hist.refetch()]);
    } catch (e) {
      setErr({ key, msg: (e as Error).message });
    }
  };

  const d = data.data;
  const stored = new Map((d?.values ?? []).map((v) => [v.key, v.value]));
  const groups = d ? [...new Set(d.catalog.map((c) => c.group))] : [];
  const current = groups.includes(group) ? group : groups[0] ?? "";
  const flagOn = (page: string) => stored.get(`ui.v2.${page}`) === true;

  const panel = (g: string) => (
    <div class="ad-stack">
      {d!.catalog.filter((c) => c.group === g).map((c) => (
        <SettingField
          key={c.key}
          label={c.label}
          description={c.description}
          shape={c.shape}
          value={stored.has(c.key) ? stored.get(c.key) : c.default}
          inherited={!stored.has(c.key)}
          saving={busy}
          error={err?.key === c.key ? err.msg : null}
          onSave={(v) => void run(() => put(c.key, { value: v }), t("common.saved"))}
          onReset={() => void run(() => put(c.key, { reset: true }), t("common.saved"))}
        />
      ))}
    </div>
  );

  return (
    <div class="ad-page">
      <header class="ad-head">
        <div>
          <h1 class="ad-title">{t("a.gs.title")}</h1>
          <p class="ad-muted">{t("a.gs.sub")}</p>
        </div>
        <Link to="/admin/portal-customers" class="ht-btn ht-btn--secondary"><span class="ht-btn__label">{t("a.gs.back")}</span></Link>
      </header>
      {data.error ? <InlineAlert tone="danger" title={t("a.err.load")} action={<Button size="sm" variant="secondary" onClick={() => void data.refetch()}>{t("common.retry")}</Button>}>{data.error.message}</InlineAlert> : null}
      {!d && !data.error ? <div class="ad-stack"><Skeleton height={40} /><Skeleton height={160} /></div> : null}
      {d ? (
        <>
          <Tabs
            label={t("a.gs.groups")}
            value={current}
            onChange={setGroup}
            tabs={groups.map((g) => ({ id: g, label: `a.group.${g}` in ar ? t(`a.group.${g}` as CopyKey) : g, panel: panel(g) }))}
          />
          <Section title={t("a.gs.v2.title")} description={t("a.gs.v2.sub")}>
            <div class="ad-stack">
              {V2_PAGES.map((p) => (
                <Switch key={p} label={t(`a.gs.v2.${p}` as CopyKey)} checked={flagOn(p)} disabled={busy} onChange={(v) => void run(() => put(`ui.v2.${p}`, { value: v }), t("common.saved"))} />
              ))}
              {err?.key.startsWith("ui.v2.") ? <InlineAlert tone="danger">{err.msg}</InlineAlert> : null}
            </div>
          </Section>
          <Section title={t("a.hist.title")} description={t("a.hist.sub")}>
            {hist.data ? (
              <HistoryList items={hist.data.items} onRevert={(id) => run(async () => { await api.post(`/portal-admin/settings-history/${id}/revert`, {}); await Promise.all([data.refetch(), hist.refetch()]); }, t("a.hist.reverted"))} />
            ) : (
              <EmptyState compact title={t("common.loading")} />
            )}
          </Section>
        </>
      ) : null}
    </div>
  );
}
