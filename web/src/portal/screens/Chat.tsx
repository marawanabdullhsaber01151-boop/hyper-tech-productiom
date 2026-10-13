import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Banner, Button, Card, EmptyState, InlineAlert, Select, Skeleton, StatusPill, useToast } from "../../design/components";
import { portalSession } from "../../auth/portalSession";
import { useChatThread } from "../../chat/useThread";
import { ChatThread } from "../../chat/ChatThread";
import type { ChatBackend, ChatMsg } from "../../chat/types";
import { formatRelative } from "../../lib/format";
import { api } from "../api";
import { chatUnreadStore } from "../chatUnread";
import { can } from "../session";
import "../../chat/chat.css";

interface Meta {
  id: number;
  mode: "shared" | "per_member" | "per_member_monitored";
  status: "open" | "closed";
  handlerName: string | null;
  unread: number;
  hours: { isOpen: boolean; whatsappNumber: string | null };
}
interface Page {
  conversation: Meta;
  messages: ChatMsg[];
  hasMore?: boolean;
}
interface TeamItem { id: number; memberId: number; name: string; status: string; preview: string; lastMessageAt: string }

const TOPICS = ["price", "order", "product", "complaint", "other"] as const;
const uuid = () => crypto.randomUUID();
const token = () => portalSession.get()?.token;

/** إشارة اختيارية في الرابط: ?context=product:12 */
function readContext(): { type: string; id: number } | null {
  const raw = new URLSearchParams(location.search).get("context");
  const m = raw?.match(/^(order|product|price_inquiry):(\d+)$/);
  return m ? { type: m[1]!, id: Number(m[2]) } : null;
}

function MyChat() {
  const toast = useToast();
  const [topic, setTopic] = useState("");
  const [ctx, setCtx] = useState(readContext);
  const [stars, setStars] = useState(0);
  const [rated, setRated] = useState(false);
  const extras = useRef({ topic: "", ctx: ctx });
  extras.current = { topic, ctx };

  const backend = useMemo<ChatBackend<Meta>>(
    () => ({
      open: async (signal) => {
        const r = await api.get<Page>("/portal/chat", { signal });
        return { messages: r.messages, hasMore: !!r.hasMore, meta: r.conversation };
      },
      older: async (before) => {
        const r = await api.get<Page>("/portal/chat", { query: { before } });
        return { messages: r.messages, hasMore: !!r.hasMore };
      },
      poll: async (after, signal) => {
        const r = await api.get<Page>("/portal/chat/poll", { query: { after }, signal });
        return { messages: r.messages, meta: r.conversation };
      },
      send: async (i) => {
        const e = extras.current;
        const r = await api.post<{ message: ChatMsg; conversation: Meta }>("/portal/chat/messages", {
          body: i.body,
          image: i.image ?? null,
          clientMsgId: i.clientMsgId,
          topic: e.topic || null,
          context: e.ctx ? { type: e.ctx.type, id: e.ctx.id } : null,
        });
        return { message: r.message, meta: r.conversation };
      },
      imagePath: (id) => `/portal/chat/attachments/${id}`,
      token,
    }),
    [],
  );
  const th = useChatThread(backend, "mine");
  const meta = th.meta;

  // علّم الرسايل مقروءة لما تظهر
  useEffect(() => {
    if (meta && meta.unread > 0) {
      void api.post("/portal/chat/read").catch(() => undefined);
      th.setMeta({ ...meta, unread: 0 });
      chatUnreadStore.set({ unread: 0 });
    }
  }, [meta?.unread, th.messages.length]);

  const pending = useRef(uuid());
  const onSend = async (i: { body: string; image: string | null }) => {
    const m = await th.send({ body: i.body, image: i.image, clientMsgId: pending.current });
    pending.current = uuid();
    setCtx(null);
    return m;
  };

  const rate = async () => {
    try {
      await api.post("/portal/chat/rating", { stars });
      setRated(true);
      toast({ tone: "success", message: t("c.p.rate.done") });
    } catch (e) {
      toast({ tone: "danger", message: (e as Error).message });
    }
  };

  if (th.error && !meta) return <InlineAlert tone="danger" title={t("c.err.load")}>{th.error.message}</InlineAlert>;
  if (th.loading || !meta) return <div class="pt-stack"><Skeleton height={48} /><Skeleton height={320} /></div>;

  const wa = meta.hours.whatsappNumber;
  return (
    <div class="pt-stack">
      <p class="pt-muted">{t(`c.p.mode.${meta.mode}` as CopyKey)}</p>
      {!meta.hours.isOpen ? (
        <Banner tone="info">
          {t("c.p.hours.closed")}{" "}
          {wa ? <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">{t("c.p.wa")}</a> : null}
        </Banner>
      ) : null}
      <div class="pt-row pt-row--between">
        <strong>{t("c.p.with", { name: meta.handlerName ?? t("c.p.team") })}</strong>
        {meta.status === "closed" ? <StatusPill tone="neutral">{t("c.a.closed")}</StatusPill> : null}
      </div>
      <div style="block-size: min(68dvh, 640px)">
        <ChatThread
          messages={th.messages}
          me="customer"
          backend={backend}
          hasMore={th.hasMore}
          onLoadOlder={() => void th.loadOlder()}
          onSend={onSend}
          composerExtra={
            <>
              {ctx ? (
                <div class="pt-row">
                  <StatusPill tone="info">{t("c.p.ctx", { type: t(`c.ctx.${ctx.type}` as CopyKey), id: ctx.id })}</StatusPill>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setCtx(null)}>{t("c.p.ctx.remove")}</Button>
                </div>
              ) : null}
              <Select
                aria-label={t("c.p.topic")}
                value={topic}
                options={[{ value: "", label: t("c.p.topic.none") }, ...TOPICS.map((k) => ({ value: k, label: t(`c.topic.${k}` as CopyKey) }))]}
                onChange={(e) => setTopic((e.currentTarget as HTMLSelectElement).value)}
              />
            </>
          }
        />
      </div>
      {meta.status === "closed" ? (
        <Card>
          <p class="pt-muted">{t("c.p.closed")}</p>
          {!rated ? (
            <div class="pt-stack">
              <strong>{t("c.p.rate.title")}</strong>
              <div class="pt-row" role="group" aria-label={t("c.p.rate.title")}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Button key={n} size="sm" variant={stars === n ? "primary" : "secondary"} aria-pressed={stars === n} onClick={() => setStars(n)}>{t("c.p.rate.star", { n })}</Button>
                ))}
              </div>
              <div><Button disabled={!stars} onClick={() => void rate()}>{t("c.p.rate.send")}</Button></div>
            </div>
          ) : <p>{t("c.p.rate.done")}</p>}
        </Card>
      ) : null}
    </div>
  );
}

function TeamChats() {
  const [items, setItems] = useState<TeamItem[] | null>(null);
  const [open, setOpen] = useState<TeamItem | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ items: TeamItem[] }>("/portal/chat/team").then((r) => setItems(r.items)).catch((e) => setErr((e as Error).message));
  }, []);

  const backend = useMemo<ChatBackend<null>>(
    () => ({
      open: async (signal) => {
        const r = await api.get<{ messages: ChatMsg[]; hasMore: boolean }>(`/portal/chat/team/${open!.id}`, { signal });
        return { messages: r.messages, hasMore: r.hasMore, meta: null };
      },
      older: async (before) => {
        const r = await api.get<{ messages: ChatMsg[]; hasMore: boolean }>(`/portal/chat/team/${open!.id}`, { query: { before } });
        return r;
      },
      poll: async () => ({ messages: [], meta: null }),
      send: () => Promise.reject(new Error("read-only")),
      imagePath: (id) => `/portal/chat/attachments/${id}`,
      token,
    }),
    [open?.id],
  );
  const th = useChatThread(backend, open?.id ?? 0, !!open);

  if (err) return <InlineAlert tone="danger">{err}</InlineAlert>;
  if (open) {
    return (
      <div class="pt-stack">
        <div class="pt-row pt-row--between">
          <strong>{open.name}</strong>
          <Button size="sm" variant="secondary" onClick={() => setOpen(null)}>{t("c.p.team.back")}</Button>
        </div>
        <p class="pt-muted">{t("c.p.team.readonly")}</p>
        <div style="block-size: min(64dvh, 600px)">
          <ChatThread messages={th.messages} me="customer" backend={backend} hasMore={th.hasMore} onLoadOlder={() => void th.loadOlder()} />
        </div>
      </div>
    );
  }
  if (!items) return <Skeleton height={120} />;
  if (!items.length) return <EmptyState title={t("c.p.team.empty")} />;
  return (
    <ul class="pt-stack" style="list-style:none;padding:0;margin:0">
      {items.map((i) => (
        <li key={i.id}>
          <Card>
            <div class="pt-row pt-row--between">
              <div>
                <strong>{i.name}</strong>
                <div class="pt-muted">{i.preview ? t("c.p.team.last", { text: i.preview }) : null} · {formatRelative(i.lastMessageAt)}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setOpen(i)}>{t("c.p.team.open")}</Button>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function Chat() {
  const [tab, setTab] = useState<"mine" | "team">("mine");
  const [teamOk, setTeamOk] = useState(false);
  useEffect(() => {
    if (!can("chat.view_company")) return;
    // الوضع مع المراقبة بس بيرد 200؛ غير كده 403 فنخفي التبويب.
    api.get("/portal/chat/team").then(() => setTeamOk(true)).catch(() => setTeamOk(false));
  }, []);
  return (
    <div class="pt-stack">
      <div>
        <h1 class="pt-page-title">{t("c.p.title")}</h1>
        <p class="pt-muted">{t("c.p.sub")}</p>
      </div>
      {teamOk ? (
        <div class="pt-row" role="group" aria-label={t("c.p.tab.label")}>
          <Button size="sm" variant={tab === "mine" ? "primary" : "secondary"} aria-pressed={tab === "mine"} onClick={() => setTab("mine")}>{t("c.p.tab.mine")}</Button>
          <Button size="sm" variant={tab === "team" ? "primary" : "secondary"} aria-pressed={tab === "team"} onClick={() => setTab("team")}>{t("c.p.tab.team")}</Button>
        </div>
      ) : null}
      {tab === "mine" ? <MyChat /> : <TeamChats />}
    </div>
  );
}
