import { useMemo, useState } from "preact/hooks";
import { t, type CopyKey } from "../../../copy";
import { DataTable, EmptyState, FilterBar, InlineAlert, Button, Select, Skeleton, type Column } from "../../../design/components";
import { useQuery } from "../../../api/hooks";
import { api } from "../../api";
import { useAct } from "../../act";
import { staffUser } from "../../session";

interface AccessUser {
  id: number;
  name: string;
  role: string;
  defaultMode: string;
  override: string | null;
  effectiveMode: string;
}
interface AccessRes {
  modes: string[];
  users: AccessUser[];
}

export const modeLabel = (m: string) => t(`c.m.${m}` as CopyKey);

/** «من يرد؟»: المدير يحدد لكل موظف دوره في الشات (يتسجّل في التدقيق). */
export function ChatAccess() {
  const q = useQuery((signal) => api.get<AccessRes>("/chat/staff-access", { signal }), []);
  const { run, busy } = useAct();
  const [search, setSearch] = useState("");
  const me = staffUser()?.id;

  const change = async (u: AccessUser, value: string) => {
    const r = await run(() => api.put(`/chat/staff-access/${u.id}`, { mode: value || null }), t("c.x.saved"));
    // لو فشل (أو نجح) بنعيد التحميل عشان القائمة تطابق السيرفر
    void r;
    await q.refetch();
  };

  const users = useMemo(() => {
    const s = search.trim();
    return (q.data?.users ?? []).filter((u) => !s || u.name.includes(s));
  }, [q.data, search]);

  const cols: Column<AccessUser>[] = [
    { key: "name", header: t("c.x.col.name"), cell: (u) => u.name, mobile: "title" },
    { key: "role", header: t("c.x.col.role"), cell: (u) => u.role },
    { key: "default", header: t("c.x.col.default"), cell: (u) => modeLabel(u.defaultMode) },
    {
      key: "mode",
      header: t("c.x.col.mode"),
      cell: (u) => (
        <Select
          aria-label={`${t("c.x.col.mode")}: ${u.name}`}
          value={u.override ?? ""}
          disabled={busy || u.id === me}
          title={u.id === me ? t("c.x.self") : undefined}
          options={[{ value: "", label: t("c.x.default", { mode: modeLabel(u.defaultMode) }) }, ...(q.data?.modes ?? []).map((m) => ({ value: m, label: modeLabel(m) }))]}
          onChange={(e) => void change(u, (e.currentTarget as HTMLSelectElement).value)}
        />
      ),
    },
  ];

  return (
    <div class="ad-stack">
      <div>
        <h2 class="cc-h2">{t("c.x.title")}</h2>
        <p class="ad-muted">{t("c.x.sub")}</p>
      </div>
      {q.error ? <InlineAlert tone="danger" title={t("c.x.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert> : null}
      {q.loading && !q.data ? <Skeleton height={160} /> : null}
      {q.data ? (
        <>
          <FilterBar search={search} onSearch={setSearch} searchLabel={t("c.x.search")} />
          <DataTable caption={t("c.x.caption")} columns={cols} rows={users} rowKey={(u) => u.id} empty={<EmptyState compact title={t("c.x.search")} />} />
        </>
      ) : null}
    </div>
  );
}
