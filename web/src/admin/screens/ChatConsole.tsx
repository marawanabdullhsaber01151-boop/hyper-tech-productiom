import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Button, Dialog, EmptyState, Field, FilterBar, InlineAlert, Select, Skeleton, StatusPill, Textarea } from "../../design/components";
import { Link, navigate } from "../../app/router";
import { useQuery } from "../../api/hooks";
import { staffSession } from "../../auth/staffSession";
import { ChatThread } from "../../chat/ChatThread";
import { useChatThread } from "../../chat/useThread";
import type { ChatBackend, ChatMsg } from "../../chat/types";
import { formatNumber, formatRelative } from "../../lib/format";
import { api } from "../api";
import { useAct } from "../act";
import { useUrlParams } from "../lib";
import { staffUser } from "../session";
import "../../chat/chat.css";

const FILTERS = ["all", "mine", "unassigned", "escalated", "unread", "closed"] as const;
const BASE = "/admin/portal-chat";
const uuid = () => crypto.randomUUID();

interface Conv {
  id: number;
  customerName: string;
  customerCompany: string | null;
  portalCustomerId: number;
  memberId: number | null;
  status: "open" | "closed";
  handler: { userId: number; name: string } | null;
  staffUnread: number;
  lastMessagePreview: string;
  lastMessageAt: string;
  escalated: boolean;
  access: { canReply: boolean; canManage: boolean; readOnly: boolean };
}
interface Inbox { items: Conv[]; hasMore: boolean; page: number }
interface Opened { conversation: Conv; messages: ChatMsg[]; hasMore: boolean; lastRating: { stars: number } | null }
interface QuickReply { id: number; title: string; body: string }

function Row({ c, active, onOpen }: { c: Conv; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" class={`cc-item${active ? " cc-item--on" : ""}`} aria-current={active ? "true" : undefined} onClick={onOpen}>
        <span class="cc-item__top">
          <strong>{c.customerCompany || c.customerName}</strong>
          {c.staffUnread > 0 ? <StatusPill tone="brand">{t("c.a.unread", { n: formatNumber(c.staffUnread) })}</StatusPill> : null}
        </span>
        <span class="cc-item__sub">{c.memberId ? `${t("c.a.member")}: ${c.customerName}` : c.customerName}</span>
        <span class="cc-item__prev">{c.lastMessagePreview}</span>
        <span class="cc-item__foot">
          <span>{formatRelative(c.lastMessageAt)}</span>
          <span class="cc-pills">
            {c.escalated ? <StatusPill tone="danger">{t("c.a.escalated")}</StatusPill> : null}
            {c.status === "closed" ? <StatusPill tone="neutral">{t("c.a.closed")}</StatusPill> : null}
            {!c.handler ? <StatusPill tone="warn">{t("c.a.noHandler")}</StatusPill> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function Conversation({ id, onChanged, onBack, manager }: { id: number; onChanged: () => void; onBack: () => void; manager: boolean }) {
  const { run, busy } = useAct();
  const rating = useRef<number | null>(null);
  const backend = useMemo<ChatBackend<Conv>>(
    () => ({
      open: async (signal) => {
        const r = await api.get<Opened>(`/chat/conversations/${id}`, { signal });
        rating.current = r.lastRating?.stars ?? null;
        return { messages: r.messages, hasMore: r.hasMore, meta: r.conversation };
      },
      older: async (before) => {
        const r = await api.get<Opened>(`/chat/conversations/${id}`, { query: { before } });
        return { messages: r.messages, hasMore: r.hasMore };
      },
      poll: async (after, signal) => {
        const r = await api.get<{ conversation: Conv; messages: ChatMsg[] }>(`/chat/conversations/${id}/poll`, { query: { after }, signal });
        return { messages: r.messages, meta: r.conversation };
      },
      send: async (i) => {
        const r = await api.post<{ message: ChatMsg }>(`/chat/conversations/${id}/messages`, { body: i.body, image: i.image ?? null, internal: !!i.internal, clientMsgId: i.clientMsgId });
        return { message: r.message };
      },
      imagePath: (mid) => `/chat/attachments/${mid}`,
      token: () => staffSession.get()?.token,
    }),
    [id],
  );
  const th = useChatThread(backend, id);
  const c = th.meta;
  const quick = useQuery((signal) => api.get<QuickReply[]>("/chat/quick-replies", { signal }), []);
  const people = useQuery((signal) => (manager ? api.get<Array<{ id: number; name: string }>>("/chat/assignable-users", { signal }) : Promise.resolve([])), [manager]);

  const [insert, setInsert] = useState<{ text: string; nonce: number } | null>(null);
  const [dlg, setDlg] = useState<null | "transfer" | "hide">(null);
  const [target, setTarget] = useState("");
  const [hideId, setHideId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const pending = useRef(uuid());

  // علّم المقروء لما فيه رسايل جديدة من العميل
  useEffect(() => {
    if (c && c.access.canReply && c.staffUnread > 0) {
      void api.post(`/chat/conversations/${id}/read`).then(() => onChanged()).catch(() => undefined);
      th.setMeta({ ...c, staffUnread: 0 });
    }
  }, [c?.staffUnread, th.messages.length]);

  const act = async (path: string, ok: string, body?: unknown) => {
    const r = await run(() => api.post(`/chat/conversations/${id}/${path}`, body), ok);
    if (r !== undefined) {
      await th.refresh();
      onChanged();
    }
    return r !== undefined;
  };

  if (th.error && !c) return <InlineAlert tone="danger" title={t("c.err.load")}>{th.error.message}</InlineAlert>;
  if (th.loading || !c) return <div class="ad-stack"><Skeleton height={48} /><Skeleton height={360} /></div>;

  return (
    <div class="cc-thread">
      <header class="cc-thread__head">
        <div>
          <Button size="sm" variant="ghost" class="cc-back" onClick={onBack}>{t("c.a.back")}</Button>
          <h2 class="cc-thread__title">{c.customerCompany || c.customerName}</h2>
          <p class="ad-muted">
            {c.memberId ? `${t("c.a.member")}: ${c.customerName} · ` : ""}
            {c.handler ? t("c.a.handler", { name: c.handler.name }) : t("c.a.noHandler")}
            {rating.current ? ` · ${t("c.a.rating", { n: rating.current })}` : ""}
          </p>
        </div>
        <div class="ad-row">
          {c.access.readOnly ? <StatusPill tone="info">{t("c.a.readonly")}</StatusPill> : null}
          {c.escalated ? <StatusPill tone="danger">{t("c.a.escalated")}</StatusPill> : null}
          <Link to={`/admin/portal-customers/${c.portalCustomerId}`} class="ht-btn ht-btn--secondary"><span class="ht-btn__label">{t("c.a.company")}</span></Link>
          {c.access.canReply && c.handler?.userId !== staffUser()?.id ? <Button variant="secondary" loading={busy} onClick={() => void act("claim", t("c.a.claimed"))}>{t("c.a.claim")}</Button> : null}
          {c.access.canManage ? <Button variant="secondary" onClick={() => { setTarget(""); setDlg("transfer"); }}>{t("c.a.transfer")}</Button> : null}
          {c.access.canReply ? (c.status === "open"
            ? <Button variant="secondary" loading={busy} onClick={() => void act("close", t("c.a.closedDone"))}>{t("c.a.close")}</Button>
            : <Button variant="secondary" loading={busy} onClick={() => void act("reopen", t("c.a.reopened"))}>{t("c.a.reopen")}</Button>) : null}
        </div>
      </header>

      <div class="cc-thread__body">
        <ChatThread
          messages={th.messages}
          me="staff"
          backend={backend}
          hasMore={th.hasMore}
          onLoadOlder={() => void th.loadOlder()}
          onSend={c.access.canReply ? async (i) => { const m = await th.send({ body: i.body, image: i.image, internal: i.internal, clientMsgId: pending.current }); pending.current = uuid(); onChanged(); return m; } : undefined}
          disabledNote={c.access.canReply ? undefined : t("c.a.readonly.note")}
          allowInternal={c.access.canReply}
          insertText={insert}
          composerExtra={quick.data?.length ? (
            <Select
              aria-label={t("c.a.quick")}
              value=""
              placeholder={t("c.a.quick.pick")}
              options={quick.data.map((q) => ({ value: String(q.id), label: q.title }))}
              onChange={(e) => {
                const q = quick.data!.find((x) => String(x.id) === (e.currentTarget as HTMLSelectElement).value);
                if (q) setInsert({ text: q.body, nonce: Date.now() });
              }}
            />
          ) : undefined}
          renderMessageActions={(m) => (c.access.canManage && m.senderType !== "system" && !m.hidden
            ? <button type="button" class="cc-link" onClick={() => { setHideId(m.id); setReason(""); setDlg("hide"); }}>{t("c.a.hide")}</button>
            : null)}
        />
      </div>

      <Dialog open={dlg === "transfer"} onClose={() => setDlg(null)} title={t("c.a.transfer.title")}
        footer={<><Button variant="ghost" onClick={() => setDlg(null)}>{t("c.a.cancel")}</Button>
          <Button loading={busy} disabled={!target} onClick={async () => { if (await act("transfer", t("c.a.transferred"), { toUserId: Number(target) })) setDlg(null); }}>{t("c.a.transfer.go")}</Button></>}>
        <Field label={t("c.a.transfer.pick")}>
          <Select value={target} placeholder={t("c.a.transfer.pick")} options={(people.data ?? []).map((u) => ({ value: String(u.id), label: u.name }))} onChange={(e) => setTarget((e.currentTarget as HTMLSelectElement).value)} />
        </Field>
      </Dialog>

      <Dialog open={dlg === "hide"} onClose={() => setDlg(null)} title={t("c.a.hide.title")} description={t("c.a.hide.body")}
        footer={<><Button variant="ghost" onClick={() => setDlg(null)}>{t("c.a.cancel")}</Button>
          <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={async () => {
            const r = await run(() => api.post(`/chat/messages/${hideId}/hide`, { reason: reason.trim() }), t("c.a.hidden"));
            if (r !== undefined) { setDlg(null); await th.refresh(); }
          }}>{t("c.a.hide.go")}</Button></>}>
        <Field label={t("c.a.hide.reason")} required>
          <Textarea rows={3} value={reason} onInput={(e) => setReason((e.currentTarget as HTMLTextAreaElement).value)} />
        </Field>
      </Dialog>
    </div>
  );
}

export function ChatConsolePage({ openId }: { openId?: number }) {
  const url = useUrlParams();
  const fp = url.get("filter", "all");
  const filter = (FILTERS as readonly string[]).includes(fp) ? fp : "all";
  const q = url.get("q");
  const [pages, setPages] = useState(1);
  const key = JSON.stringify({ filter, q, pages });

  const list = useQuery(async (signal) => {
    const out: Conv[] = [];
    let hasMore = false;
    for (let p = 1; p <= pages; p += 1) {
      const r = await api.get<Inbox>("/chat/inbox", { query: { filter, q, page: p }, signal });
      out.push(...r.items);
      hasMore = r.hasMore;
    }
    return { items: out, hasMore };
  }, [key]);
  useEffect(() => setPages(1), [filter, q]);
  useEffect(() => {
    const id = setInterval(() => !document.hidden && void list.refetch(), 10_000);
    return () => clearInterval(id);
  }, [key]);

  const summary = useQuery((signal) => api.get<{ mode: string }>("/chat/summary", { signal }), []);
  const manager = summary.data?.mode === "manager";
  const items = list.data?.items ?? [];
  const open = (c: Conv) => navigate(`${BASE}/${c.id}${url.search}`);

  return (
    <div class="ad-page">
      <header class="ad-head">
        <div>
          <h1 class="ad-title">{t("c.a.title")}</h1>
          <p class="ad-muted">{t("c.a.sub")}</p>
        </div>
        <a class="ht-btn ht-btn--secondary" href="/chat-staff.html?legacy=1"><span class="ht-btn__label">{t("c.a.legacy")}</span></a>
      </header>

      <div class="ad-chips" role="group" aria-label={t("c.a.filters")}>
        {FILTERS.map((f) => (
          <button key={f} type="button" class="ad-chip" aria-pressed={filter === f} onClick={() => url.set({ filter: f === "all" ? "" : f })}>{t(`c.a.filter.${f}` as CopyKey)}</button>
        ))}
      </div>

      <div class={`cc${openId ? " cc--open" : ""}`}>
        <aside class="cc-list" aria-label={t("c.a.list")}>
          <FilterBar search={q} onSearch={(v) => url.set({ q: v })} searchLabel={t("c.a.search")} />
          {list.error ? <InlineAlert tone="danger" title={t("c.a.err.list")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>}>{list.error.message}</InlineAlert> : null}
          {list.loading && !items.length ? <Skeleton height={120} /> : null}
          {!list.loading && !items.length && !list.error ? <EmptyState title={t("c.a.empty")} /> : null}
          <ul class="cc-items">
            {items.map((c) => <Row key={c.id} c={c} active={c.id === openId} onOpen={() => open(c)} />)}
          </ul>
          {list.data?.hasMore ? <Button variant="secondary" onClick={() => setPages((p) => p + 1)}>{t("c.a.more")}</Button> : null}
        </aside>
        <section class="cc-main">
          {openId ? <Conversation id={openId} manager={manager} onChanged={() => void list.refetch()} onBack={() => navigate(`${BASE}${url.search}`)} /> : <EmptyState title={t("c.a.pick")} />}
        </section>
      </div>
    </div>
  );
}
