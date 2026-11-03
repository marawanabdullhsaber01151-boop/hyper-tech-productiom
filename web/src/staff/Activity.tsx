import "../copy/activity";
import { useEffect, useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t } from "../copy";
import { Button, Checkbox, EmptyState, InlineAlert, Input, Select, StatusPill } from "../design/components";
import { EMPTY_FILTERS, ONLINE_REFRESH_MS, activityQuery, filtersError, groupByDay, mergeRows, onlineKind, type ActivityFilters, type ActivityMeta, type ActivityPage, type ActivityRow, type OnlineUser } from "./activityCore";
import { presetRange } from "./oeeCore";
import "./Activity.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;

/** سجل النشاط: جمل بسيطة (مين عمل إيه وامتى) من سجل التدقيق، بفلاتر وترقيم. */
export function Activity() {
  const [f, setF] = useState<ActivityFilters>(EMPTY_FILTERS);
  const bad = filtersError(f);
  const meta = useQuery((signal) => api.get<ActivityMeta>("/activity/meta", { signal }), []);
  const sig = activityQuery(f);
  const first = useQuery((signal) => (bad ? Promise.resolve(undefined) : api.get<ActivityPage>(`/activity${sig}`, { signal })), [sig, bad]);
  const online = useQuery((signal) => api.get<OnlineUser[]>("/activity/online", { signal }), []);
  useEffect(() => {
    const id = setInterval(() => void online.refetch(), ONLINE_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  const [extra, setExtra] = useState<ActivityRow[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const act = useAct();

  // أي تغيير في الفلاتر أو أول صفحة جديدة بيصفّر الصفحات الإضافية
  useEffect(() => { setExtra([]); setNext(first.data ? first.data.nextBefore : null); }, [first.data]);

  const base = first.data?.data ?? [];
  const rows = mergeRows(base, extra);
  const groups = groupByDay(rows);
  const more = async () => {
    if (!next) return;
    const page = await act.run(() => api.get<ActivityPage>(`/activity${activityQuery(f, next)}`), undefined);
    if (page) { setExtra((p) => mergeRows(p, page.data)); setNext(page.nextBefore); }
  };
  const set = (patch: Partial<ActivityFilters>) => setF((p) => ({ ...p, ...patch }));
  const metaOk = meta.data;

  return (
    <div class="ad-page">
      <div>
        <h1 class="ad-title">{t("act.title")}</h1>
        <p class="st-login__sub">{t("act.subtitle")}</p>
      </div>
      <section aria-label={t("act.online.title", { n: online.data?.length ?? 0 })}>
        <h2 class="act-day">{t("act.online.title", { n: online.data?.length ?? 0 })}</h2>
        {online.error ? <InlineAlert tone="warn">{t("act.online.fail")}</InlineAlert> : null}
        {!online.loading && !online.error && !(online.data?.length) ? <p class="act-muted">{t("act.online.none")}</p> : null}
        <ul class="act-list">
          {(online.data ?? []).map((u) => (
            <li key={u.userId} class="act-item">
              <span class="act-time">{onlineKind(u.minutesAgo) === "now" ? t("act.online.now") : t("act.online.ago", { n: u.minutesAgo })}</span>
              <span>{u.name} <StatusPill tone="neutral">{u.roleLabel}</StatusPill></span>
            </li>
          ))}
        </ul>
        <p class="act-muted">{t("act.online.privacy")}</p>
      </section>
      {meta.error ? <InlineAlert tone="warn">{t("act.metaFail")}</InlineAlert> : null}
      <div class="act-toolbar">
        <Select aria-label={t("act.actor")} value={f.actorId} onChange={(e) => set({ actorId: val(e) })} options={[{ value: "", label: t("act.actorAll") }, ...(metaOk?.actors ?? []).map((a) => ({ value: String(a.id), label: `${a.name} (${a.roleLabel})` }))]} />
        <Select aria-label={t("act.section")} value={f.section} onChange={(e) => set({ section: val(e) })} options={[{ value: "", label: t("act.sectionAll") }, ...(metaOk?.sections ?? []).map((s) => ({ value: s.id, label: s.label }))]} />
        <Button size="sm" variant="ghost" onClick={() => set({ ...presetRange("today") })}>{t("act.preset.today")}</Button>
        <Button size="sm" variant="ghost" onClick={() => set({ ...presetRange("week") })}>{t("act.preset.week")}</Button>
        <Button size="sm" variant="ghost" onClick={() => set({ from: "", to: "" })}>{t("act.preset.all")}</Button>
        <Input type="date" aria-label={t("act.from")} value={f.from} onInput={(e) => set({ from: val(e) })} />
        <Input type="date" aria-label={t("act.to")} value={f.to} onInput={(e) => set({ to: val(e) })} />
        <Checkbox label={t("act.views")} checked={f.includeViews} onChange={(e) => set({ includeViews: (e.target as HTMLInputElement).checked })} />
      </div>
      {bad ? <InlineAlert tone="warn">{t("act.rangeBad")}</InlineAlert> : null}
      {first.error ? <InlineAlert tone="warn">{t("act.loadFail")}</InlineAlert> : null}
      {!first.loading && !first.error && !bad && !rows.length ? <EmptyState title={t("act.empty")} compact /> : null}
      {groups.map((g) => (
        <section key={g.day}>
          <h2 class="act-day">{g.day}</h2>
          <ul class="act-list">
            {g.rows.map((r) => (
              <li key={r.id} class="act-item">
                <span class="act-time">{r.time}</span>
                <span>
                  {r.sentence}{" "}
                  {r.sectionLabel ? <StatusPill tone="neutral">{r.sectionLabel}</StatusPill> : null}{" "}
                  {r.rejected ? <StatusPill tone="danger">{t("act.rejected")}</StatusPill> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {next ? <div><Button variant="secondary" loading={act.busy} onClick={() => void more()}>{t("act.more")}</Button></div> : null}
      <p class="act-muted">{t("act.note")}</p>
    </div>
  );
}
