import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { ApiError } from "../api/client";
import type { ChatBackend, ChatMsg, ChatSendInput } from "./types";

const POLL_MS = 4000;

/** بيدمج رسايل جديدة في القايمة من غير تكرار، مرتّبة بالرقم. */
export function mergeMessages(list: ChatMsg[], incoming: ChatMsg[]): ChatMsg[] {
  if (!incoming.length) return list;
  const map = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort((a, b) => a.id - b.id);
}

/**
 * بيفتح المحادثة ويعمل polling خفيف (بس لما الصفحة ظاهرة).
 * `key` لو اتغيّر بيفتح محادثة تانية من الأول.
 */
export function useChatThread<Meta>(backend: ChatBackend<Meta>, key: string | number, enabled = true) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const lastId = useRef(0);
  const be = useRef(backend);
  be.current = backend;
  const tickRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const ctrl = new AbortController();
    setMessages([]);
    setMeta(null);
    setError(null);
    setLoading(true);
    lastId.current = 0;
    be.current
      .open(ctrl.signal)
      .then((r) => {
        if (!alive) return;
        setMessages(r.messages);
        setMeta(r.meta);
        setHasMore(r.hasMore);
        lastId.current = r.messages.reduce((m, x) => Math.max(m, x.id), 0);
      })
      .catch((e) => alive && (e as Error).name !== "AbortError" && setError(e as ApiError))
      .finally(() => alive && setLoading(false));

    const tick = async () => {
      if (document.hidden || !alive) return;
      try {
        const r = await be.current.poll(lastId.current, ctrl.signal);
        if (!alive) return;
        setMeta(r.meta);
        if (r.messages.length) {
          lastId.current = Math.max(lastId.current, ...r.messages.map((x) => x.id));
          setMessages((cur) => mergeMessages(cur, r.messages));
        }
      } catch {
        /* الـ polling بيتجاهل الأخطاء المؤقتة */
      }
    };
    tickRef.current = tick;
    const timer = setInterval(() => void tick(), POLL_MS);
    const vis = () => !document.hidden && void tick();
    document.addEventListener("visibilitychange", vis);
    return () => {
      alive = false;
      ctrl.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [key, enabled]);

  const loadOlder = useCallback(async () => {
    const first = messages[0]?.id;
    if (!first) return;
    const r = await be.current.older(first);
    setMessages((cur) => mergeMessages(cur, r.messages));
    setHasMore(r.hasMore);
  }, [messages]);

  const send = useCallback(async (input: ChatSendInput) => {
    const r = await be.current.send(input);
    lastId.current = Math.max(lastId.current, r.message.id);
    setMessages((cur) => mergeMessages(cur, [r.message]));
    if (r.meta) setMeta(r.meta);
    return r.message;
  }, []);

  const refresh = useCallback(() => tickRef.current(), []);

  return { messages, meta, hasMore, loading, error, loadOlder, send, setMeta, refresh };
}
