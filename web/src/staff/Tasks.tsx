import { useMemo, useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Checkbox, DataTable, Dialog, Drawer, EmptyState, Field, FilterBar, InlineAlert, Input, Select, Skeleton, Stat, StatusPill, Tabs, Textarea, Timeline, useToast, type Column, type Option } from "../design/components";
import { Plus } from "../design/icons";
import { formatDateTime, formatNumber } from "../lib/format";
import {
  ASSIGNABLE_ROLES,
  DUE_TONE,
  PRIORITY_TONE,
  STATUS_TONE,
  TASK_PRIORITIES,
  canAct,
  dueState,
  emptyDraft,
  isActive,
  isTaskManager,
  sortTasks,
  taskCounts,
  toPayload,
  validateDraft,
  type TaskDetail,
  type TaskDraft,
  type TaskEvent,
  type TaskPriority,
  type TaskRow,
} from "./tasksCore";
import "./Tasks.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const roleName = (r: string | null) => (r ? t(`tasks.role.${r}` as CopyKey) : "");
const roleOptions: Option[] = ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleName(r) }));
const eventLabel = (e: string) => {
  const key = `tasks.event.${e}` as CopyKey;
  return ["created", "claimed", "completed", "cancelled", "reassigned", "escalated_l1", "escalated_l2"].includes(e) ? t(key) : t("tasks.event.other");
};

function assigneeText(r: TaskRow, myId: number | undefined) {
  if (r.assigneeUserId) return r.assigneeUserId === myId ? t("tasks.assignee.me") : t("tasks.assignee.user");
  return roleName(r.assigneeRole);
}

function DuePill({ task }: { task: TaskRow }) {
  const s = dueState(task);
  if (!task.dueAt) return <span class="tk-muted">{t("tasks.noDue")}</span>;
  return (
    <span class="tk-due">
      {formatDateTime(task.dueAt)}
      {s === "overdue" ? <StatusPill tone={DUE_TONE.overdue}>{t("tasks.overdue")}</StatusPill> : null}
      {s === "due_soon" ? <StatusPill tone={DUE_TONE.due_soon}>{t("tasks.soon")}</StatusPill> : null}
    </span>
  );
}

/** المهام: مهامي ومهام الفريق (للمديرين). كل مهمة متأخرة بتتصعّد لوحدها من السيرفر. */
export function Tasks() {
  const me = staffUser();
  const manager = isTaskManager(me?.role);
  const [tab, setTab] = useState("mine");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [openId, setOpenId] = useState<number | null>(() => {
    const n = Number(new URLSearchParams(location.search).get("task"));
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  const [creating, setCreating] = useState(false);

  const scope = tab === "team" && manager ? "team" : "mine";
  const list = useQuery((signal) => api.get<TaskRow[]>("/tasks", { query: { scope, status: showAll ? "all" : "active" }, signal }), [scope, showAll]);
  const rows = Array.isArray(list.data) ? list.data : [];
  const counts = useMemo(() => taskCounts(rows), [rows]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return sortTasks(rows).filter((r) => !s || r.title.toLowerCase().includes(s));
  }, [rows, search]);

  const columns: Column<TaskRow>[] = [
    { key: "title", header: t("tasks.col.title"), cell: (r) => r.title, mobile: "title" },
    { key: "who", header: t("tasks.col.assignee"), cell: (r) => assigneeText(r, me?.id), mobile: "hide" },
    { key: "due", header: t("tasks.col.due"), cell: (r) => <DuePill task={r} /> },
    { key: "pri", header: t("tasks.col.priority"), cell: (r) => <StatusPill tone={PRIORITY_TONE[r.priority]}>{t(`tasks.priority.${r.priority}` as CopyKey)}</StatusPill>, mobile: "hide" },
    {
      key: "st",
      header: t("tasks.col.status"),
      cell: (r) => (
        <span class="tk-due">
          <StatusPill tone={STATUS_TONE[r.status]}>{t(`tasks.status.${r.status}` as CopyKey)}</StatusPill>
          {r.escalationLevel > 0 && isActive(r.status) ? <StatusPill tone="danger">{t("tasks.level", { n: r.escalationLevel })}</StatusPill> : null}
        </span>
      ),
    },
  ];

  const panel = (
    <>
      <div class="tk-stats">
        <Stat label={t("tasks.stat.active")} value={formatNumber(counts.active)} />
        <Stat label={t("tasks.stat.overdue")} value={formatNumber(counts.overdue)} tone={counts.overdue ? "danger" : "neutral"} />
        <Stat label={t("tasks.stat.soon")} value={formatNumber(counts.dueSoon)} tone={counts.dueSoon ? "warn" : "neutral"} />
      </div>
      <FilterBar search={search} onSearch={setSearch} searchLabel={t("tasks.search")} activeCount={showAll ? 1 : 0} onClear={() => setShowAll(false)}>
        <Checkbox label={t("tasks.filter.all")} checked={showAll} onChange={(e) => setShowAll((e.target as HTMLInputElement).checked)} />
      </FilterBar>
      {list.error ? (
        <InlineAlert tone="danger" title={t("tasks.err")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("tasks.retry")}</Button>}>
          {list.error.message}
        </InlineAlert>
      ) : null}
      <DataTable columns={columns} rows={shown} rowKey={(r) => r.id} caption={t("tasks.caption")} loading={list.loading} onRowClick={(r) => setOpenId(r.id)} empty={<EmptyState title={t("tasks.empty.title")} description={t("tasks.empty.body")} compact />} />
    </>
  );

  return (
    <div class="ad-page">
      <h1 class="ad-title">{t("tasks.title")}</h1>
      <p class="st-login__sub">{t("tasks.subtitle")}</p>
      <div class="tk-bar">
        <Button icon={Plus} onClick={() => setCreating(true)}>{t("tasks.new")}</Button>
      </div>
      {manager ? (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "mine", label: t("tasks.tab.mine"), panel: tab === "mine" ? panel : null },
            { id: "team", label: t("tasks.tab.team"), panel: tab === "team" ? panel : null },
          ]}
        />
      ) : (
        panel
      )}
      {openId !== null ? <TaskDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => void list.refetch()} /> : null}
      {creating ? (
        <TaskEditor
          manager={manager}
          onClose={() => setCreating(false)}
          onSaved={(task) => {
            setCreating(false);
            void list.refetch();
            setOpenId(task.id);
          }}
        />
      ) : null}
    </div>
  );
}

function TaskEditor({ manager, onClose, onSaved }: { manager: boolean; onClose: () => void; onSaved: (task: TaskRow) => void }) {
  const me = staffUser();
  const act = useAct();
  const toast = useToast();
  const [d, setD] = useState<TaskDraft>(emptyDraft);
  const [tried, setTried] = useState(false);
  const v = useMemo(() => validateDraft(d), [d]);
  const save = async () => {
    setTried(true);
    if (!v.ok || !me) return;
    const r = await act.run(() => api.post<TaskRow>("/tasks", toPayload(d, me.id)));
    if (!r) return;
    toast({ tone: "success", message: t("tasks.ed.created") });
    onSaved(r);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("tasks.ed.title")}
      description={t("tasks.ed.desc")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} onClick={() => void save()}>{t("tasks.ed.save")}</Button>
        </>
      }
    >
      <div class="tk-form">
        <Field label={t("tasks.ed.name")} required error={tried && v.errors.title ? t("tasks.ed.err.title") : null}>
          <Input value={d.title} maxLength={200} onInput={(e) => setD((x) => ({ ...x, title: val(e) }))} />
        </Field>
        <Field label={t("tasks.ed.details")} optional>
          <Textarea rows={3} value={d.description} onInput={(e) => setD((x) => ({ ...x, description: (e.target as HTMLTextAreaElement).value }))} />
        </Field>
        <div class="tk-grid">
          <Field label={t("tasks.ed.priority")}>
            <Select value={d.priority} options={TASK_PRIORITIES.map((p) => ({ value: p, label: t(`tasks.priority.${p}` as CopyKey) }))} onChange={(e) => setD((x) => ({ ...x, priority: (e.target as HTMLSelectElement).value as TaskPriority }))} />
          </Field>
          <Field label={t("tasks.ed.due")} optional error={tried && v.errors.due ? t("tasks.ed.err.due") : null}>
            <Input type="datetime-local" value={d.due} onInput={(e) => setD((x) => ({ ...x, due: val(e) }))} />
          </Field>
        </div>
        {manager ? (
          <>
            <Field label={t("tasks.ed.target")}>
              <Select
                value={d.target}
                options={[
                  { value: "me", label: t("tasks.ed.target.me") },
                  { value: "role", label: t("tasks.ed.target.role") },
                ]}
                onChange={(e) => setD((x) => ({ ...x, target: (e.target as HTMLSelectElement).value as "me" | "role" }))}
              />
            </Field>
            {d.target === "role" ? (
              <Field label={t("tasks.ed.role")} required error={tried && v.errors.role ? t("tasks.ed.err.role") : null}>
                <Select value={d.role} placeholder={t("tasks.ed.role.pick")} options={roleOptions} onChange={(e) => setD((x) => ({ ...x, role: (e.target as HTMLSelectElement).value }))} />
              </Field>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

type Mode = null | "complete" | "cancel" | "reassign";

function TaskDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const me = staffUser();
  const act = useAct();
  const toast = useToast();
  const q = useQuery((signal) => api.get<TaskDetail>(`/tasks/${id}`, { signal }), [id]);
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [role, setRole] = useState("");
  const [tried, setTried] = useState(false);
  const task = q.data?.task;
  const events: TaskEvent[] = q.data?.events ?? [];
  const active = !!task && isActive(task.status);
  const mayAct = !!task && !!me && canAct(task, me);
  const manager = isTaskManager(me?.role);

  const done = (message: string) => {
    toast({ tone: "success", message });
    setMode(null);
    setText("");
    setTried(false);
    void q.refetch();
    onChanged();
  };
  const claim = async () => {
    if (await act.run(() => api.post(`/tasks/${id}/claim`, {}))) done(t("tasks.act.claimed"));
  };
  const submit = async () => {
    setTried(true);
    if (text.trim().length < 2 || (mode === "reassign" && !role)) return;
    const body = mode === "complete" ? { note: text.trim() } : mode === "cancel" ? { reason: text.trim() } : { assigneeRole: role, reason: text.trim() };
    const path = mode === "complete" ? `/tasks/${id}/complete` : mode === "cancel" ? `/tasks/${id}/cancel` : `/tasks/${id}/reassign`;
    const msg = mode === "complete" ? t("tasks.act.completed") : mode === "cancel" ? t("tasks.act.cancelled") : t("tasks.act.reassigned");
    if (await act.run(() => api.post(path, body))) done(msg);
  };
  const label = mode === "complete" ? t("tasks.note.label") : mode === "cancel" ? t("tasks.reason.label") : t("tasks.reassign.reason");
  const confirm = mode === "complete" ? t("tasks.complete.confirm") : mode === "cancel" ? t("tasks.cancel.confirm") : t("tasks.reassign.confirm");

  return (
    <Drawer open onClose={onClose} title={task?.title ?? t("tasks.detail.title")} description={t("tasks.detail.title")}>
      {q.loading && !task ? (
        <div aria-busy="true" aria-label={t("tasks.detail.loading")}>
          <Skeleton lines={4} height={32} />
        </div>
      ) : q.error || !task ? (
        <InlineAlert tone="danger" title={t("tasks.detail.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("tasks.retry")}</Button>}>
          {q.error?.message}
        </InlineAlert>
      ) : (
        <div class="tk-detail">
          <div class="tk-pills">
            <StatusPill tone={STATUS_TONE[task.status]}>{t(`tasks.status.${task.status}` as CopyKey)}</StatusPill>
            <StatusPill tone={PRIORITY_TONE[task.priority]}>{t(`tasks.priority.${task.priority}` as CopyKey)}</StatusPill>
            {task.escalationLevel > 0 && active ? <StatusPill tone="danger">{t("tasks.level", { n: task.escalationLevel })}</StatusPill> : null}
          </div>
          {task.description ? <p class="tk-desc">{task.description}</p> : null}
          <dl class="tk-facts">
            <div>
              <dt>{t("tasks.detail.due")}</dt>
              <dd><DuePill task={task} /></dd>
            </div>
            <div>
              <dt>{t("tasks.detail.assignee")}</dt>
              <dd>{assigneeText(task, me?.id)}</dd>
            </div>
            <div>
              <dt>{t("tasks.detail.escalate")}</dt>
              <dd>{roleName(task.escalateToRole)}</dd>
            </div>
            {task.resultNote ? (
              <div class="tk-facts__wide">
                <dt>{t("tasks.detail.result")}</dt>
                <dd>{task.resultNote}</dd>
              </div>
            ) : null}
          </dl>

          {active && mode === null ? (
            <div class="tk-actions">
              {mayAct && task.status === "open" ? <Button loading={act.busy} onClick={() => void claim()}>{t("tasks.act.claim")}</Button> : null}
              {mayAct ? <Button variant="secondary" onClick={() => setMode("complete")}>{t("tasks.act.complete")}</Button> : null}
              {manager ? <Button variant="ghost" onClick={() => setMode("reassign")}>{t("tasks.act.reassign")}</Button> : null}
              {manager || task.createdBy === me?.id ? <Button variant="ghost" onClick={() => setMode("cancel")}>{t("tasks.act.cancel")}</Button> : null}
            </div>
          ) : null}

          {active && mode !== null ? (
            <div class="tk-form">
              {mode === "reassign" ? (
                <Field label={t("tasks.reassign.label")} required error={tried && !role ? t("tasks.ed.err.role") : null}>
                  <Select value={role} placeholder={t("tasks.ed.role.pick")} options={roleOptions} onChange={(e) => setRole((e.target as HTMLSelectElement).value)} />
                </Field>
              ) : null}
              <Field label={label} required error={tried && text.trim().length < 2 ? t("tasks.err.short") : null}>
                <Textarea rows={3} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
              </Field>
              <div class="tk-actions">
                <Button loading={act.busy} onClick={() => void submit()}>{confirm}</Button>
                <Button variant="ghost" onClick={() => (setMode(null), setText(""), setTried(false))}>{t("common.cancel")}</Button>
              </div>
            </div>
          ) : null}

          <h3 class="tk-h">{t("tasks.detail.history")}</h3>
          {events.length === 0 ? (
            <p class="tk-muted">{t("tasks.detail.noHistory")}</p>
          ) : (
            <Timeline
              items={events.map((e) => ({
                id: e.id,
                title: eventLabel(e.event),
                meta: formatDateTime(e.createdAt),
                body: e.detail,
                tone: e.event.startsWith("escalated") ? "danger" : e.event === "completed" ? "success" : "neutral",
              }))}
            />
          )}
        </div>
      )}
    </Drawer>
  );
}
