import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { t, type CopyKey } from "../copy";
import { Button, Icon, IconButton, StatusPill, Textarea, useToast } from "../design/components";
import { Check, ImageOff, Send, X } from "../design/icons";
import { formatDateTime } from "../lib/format";
import { ALLOWED_IMAGE, compressImage } from "./compress";
import type { ChatBackend, ChatMsg } from "./types";

/** صورة محمية بتوكن الجلسة: بنحمّلها blob ونعرضها. */
function ProtectedImage({ id, backend }: { id: number; backend: Pick<ChatBackend<unknown>, "imagePath" | "token"> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    const token = backend.token();
    fetch(`/api/v1${backend.imagePath(id)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("x"))))
      .then((b) => {
        if (!alive) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);
  if (failed) return <span class="ch-img-fail"><Icon icon={ImageOff} size={16} /> {t("c.image.failed")}</span>;
  if (!url) return <span class="ch-img-ph" aria-hidden="true" />;
  return <img class="ch-img" src={url} alt={t("c.image.alt")} />;
}

const TICK: Record<string, CopyKey> = { sent: "c.status.sent", delivered: "c.status.delivered", read: "c.status.read" };

export interface ChatThreadProps {
  messages: ChatMsg[];
  /** مين "أنا" في المحادثة دي */
  me: "customer" | "staff";
  backend: Pick<ChatBackend<unknown>, "imagePath" | "token">;
  hasMore?: boolean;
  onLoadOlder?: () => void;
  /** لو متبعتت: الكومبوزر بيظهر */
  onSend?: (input: { body: string; image: string | null; internal: boolean }) => Promise<unknown>;
  allowInternal?: boolean;
  disabledNote?: string;
  placeholder?: string;
  /** حاجات فوق مربع الكتابة (موضوع، رد جاهز، إشارة...) */
  composerExtra?: ComponentChildren;
  /** بيحط نص جاهز في مربع الكتابة (للرد الجاهز) */
  insertText?: { text: string; nonce: number } | null;
  renderMessageActions?: (m: ChatMsg) => ComponentChildren;
  emptyText?: string;
}

export function ChatThread(p: ChatThreadProps) {
  const toast = useToast();
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (p.insertText) setText((cur) => (cur ? `${cur}\n${p.insertText!.text}` : p.insertText!.text));
  }, [p.insertText?.nonce]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [p.messages.length]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const pickFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    if (!ALLOWED_IMAGE.test(f.type)) return toast({ tone: "danger", message: t("c.image.bad") });
    try {
      setImage(await compressImage(f));
    } catch {
      toast({ tone: "danger", message: t("c.image.big") });
    }
  };

  const submit = async () => {
    if (busy || !p.onSend) return;
    const body = text.trim();
    if (!body && !image) return;
    setBusy(true);
    try {
      await p.onSend({ body, image: internal ? null : image, internal });
      setText("");
      setImage(null);
      stick.current = true;
    } catch (e) {
      toast({ tone: "danger", message: (e as Error).message || t("c.err.send") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="ch">
      <div class="ch-list" ref={listRef} onScroll={onScroll} role="log" aria-label={t("c.thread.label")} aria-live="polite">
        {p.hasMore ? <div class="ch-more"><Button size="sm" variant="ghost" onClick={p.onLoadOlder}>{t("c.older")}</Button></div> : null}
        {!p.messages.length ? <p class="ch-empty">{p.emptyText ?? t("c.empty")}</p> : null}
        {p.messages.map((m) => {
          if (m.kind === "system") return <div class="ch-sys" key={m.id}><span>{m.body}</span></div>;
          const mine = m.senderType === p.me;
          return (
            <div class={`ch-row${mine ? " ch-row--mine" : ""}`} key={m.id}>
              <div class={`ch-bubble${mine ? " ch-bubble--mine" : ""}${m.isInternal ? " ch-bubble--internal" : ""}${m.hidden ? " ch-bubble--hidden" : ""}`}>
                <div class="ch-who">
                  {m.senderName ?? ""}
                  {m.isInternal ? <StatusPill tone="warn">{t("c.internal.tag")}</StatusPill> : null}
                </div>
                {m.context ? <div class="ch-ctx">{t(`c.ctx.${m.context.type}` as CopyKey)}: {m.context.label}</div> : null}
                {m.kind === "image" && m.attachment ? (
                  m.attachment.expired ? <span class="ch-img-fail"><Icon icon={ImageOff} size={16} /> {t("c.image.expired")}</span> : <ProtectedImage id={m.attachment.id} backend={p.backend} />
                ) : null}
                {m.body ? <p class="ch-body">{m.hidden ? <em>{t("c.hidden")}</em> : m.body}</p> : null}
                <div class="ch-meta">
                  <time dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time>
                  {m.topic ? <StatusPill tone="neutral">{t(`c.topic.${m.topic}` as CopyKey)}</StatusPill> : null}
                  {mine && m.status ? <span class={`ch-tick ch-tick--${m.status}`}><Icon icon={Check} size={14} /> {t(TICK[m.status]!)}</span> : null}
                  {p.renderMessageActions?.(m)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {p.onSend ? (
        <form class="ch-composer" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {p.composerExtra}
          {image ? (
            <div class="ch-preview">
              <img src={image} alt={t("c.image.alt")} />
              <IconButton icon={X} label={t("c.image.remove")} onClick={() => setImage(null)} />
            </div>
          ) : null}
          {p.allowInternal ? (
            <label class="ch-internal">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal((e.currentTarget as HTMLInputElement).checked)} />
              <span>{t("c.a.internal")}</span>
            </label>
          ) : null}
          <div class="ch-input">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pickFile} />
            {!internal ? <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>{t("c.attach")}</Button> : null}
            <Textarea
              rows={2}
              value={text}
              placeholder={internal ? t("c.a.internal.placeholder") : p.placeholder ?? t("c.composer.placeholder")}
              aria-label={p.placeholder ?? t("c.composer.placeholder")}
              onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <Button type="submit" icon={Send} loading={busy} disabled={!text.trim() && !image}>{t("c.send")}</Button>
          </div>
        </form>
      ) : p.disabledNote ? (
        <p class="ch-note">{p.disabledNote}</p>
      ) : null}
    </div>
  );
}
