import { useState } from "preact/hooks";
import { t } from "../../../copy";
import { Button, ConfirmDialog, Dialog, EmptyState, Field, InlineAlert, Input, Section, Skeleton, Textarea } from "../../../design/components";
import { Pencil, Plus, Trash } from "../../../design/icons";
import { useQuery } from "../../../api/hooks";
import { api } from "../../api";
import { useAct } from "../../act";

interface QuickReply {
  id: number;
  title: string;
  body: string;
}

const valid = (title: string, body: string) => title.trim().length >= 2 && title.trim().length <= 40 && body.trim().length >= 2 && body.trim().length <= 2000;

/** إدارة الردود الجاهزة (للمدير): إضافة / تعديل / مسح. */
export function ChatQuick() {
  const q = useQuery((signal) => api.get<QuickReply[]>("/chat/quick-replies", { signal }), []);
  const { run, busy } = useAct();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [edit, setEdit] = useState<QuickReply | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eBody, setEBody] = useState("");
  const [del, setDel] = useState<QuickReply | null>(null);

  const add = async () => {
    if (!valid(title, body)) return;
    const r = await run(() => api.post("/chat/quick-replies", { title: title.trim(), body: body.trim() }), t("c.q.added"));
    if (r !== undefined) {
      setTitle("");
      setBody("");
      await q.refetch();
    }
  };
  const startEdit = (x: QuickReply) => {
    setEdit(x);
    setETitle(x.title);
    setEBody(x.body);
  };
  const saveEdit = async () => {
    if (!edit || !valid(eTitle, eBody)) return;
    const r = await run(() => api.patch(`/chat/quick-replies/${edit.id}`, { title: eTitle.trim(), body: eBody.trim() }), t("common.saved"));
    if (r !== undefined) {
      setEdit(null);
      await q.refetch();
    }
  };
  const remove = async () => {
    if (!del) return;
    const r = await run(() => api.patch(`/chat/quick-replies/${del.id}`, { isActive: false }), t("c.q.deleted"));
    if (r !== undefined) {
      setDel(null);
      await q.refetch();
    }
  };

  return (
    <div class="ad-stack">
      <div>
        <h2 class="cc-h2">{t("c.q.title")}</h2>
        <p class="ad-muted">{t("c.q.sub")}</p>
      </div>

      <Section title={t("c.q.new")}>
        <div class="cc-form">
          <Field label={t("c.q.field.title")} hint={t("c.q.field.title.hint")}>
            <Input value={title} maxLength={40} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} />
          </Field>
          <Field label={t("c.q.field.body")}>
            <Textarea rows={3} maxLength={2000} value={body} onInput={(e) => setBody((e.currentTarget as HTMLTextAreaElement).value)} />
          </Field>
          <div>
            <Button icon={Plus} loading={busy} disabled={!valid(title, body)} onClick={() => void add()}>{t("c.q.add")}</Button>
          </div>
        </div>
      </Section>

      {q.error ? <InlineAlert tone="danger" title={t("c.q.err")}>{q.error.message}</InlineAlert> : null}
      {q.loading && !q.data ? <Skeleton height={100} /> : null}
      {q.data && !q.data.length ? <EmptyState title={t("c.q.empty")} /> : null}
      <ul class="cc-quick">
        {(q.data ?? []).map((x) => (
          <li key={x.id} class="cc-quick__item">
            <div class="cc-quick__text">
              <strong>{x.title}</strong>
              <p>{x.body}</p>
            </div>
            <div class="ad-row">
              <Button size="sm" variant="secondary" icon={Pencil} onClick={() => startEdit(x)}>{t("common.edit")}</Button>
              <Button size="sm" variant="ghost" icon={Trash} onClick={() => setDel(x)}>{t("common.delete")}</Button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={!!edit} onClose={() => setEdit(null)} title={t("c.q.edit")}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>{t("common.cancel")}</Button>
          <Button loading={busy} disabled={!valid(eTitle, eBody)} onClick={() => void saveEdit()}>{t("c.q.save")}</Button></>}>
        <div class="cc-form">
          <Field label={t("c.q.field.title")}>
            <Input value={eTitle} maxLength={40} onInput={(e) => setETitle((e.currentTarget as HTMLInputElement).value)} />
          </Field>
          <Field label={t("c.q.field.body")}>
            <Textarea rows={4} maxLength={2000} value={eBody} onInput={(e) => setEBody((e.currentTarget as HTMLTextAreaElement).value)} />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => void remove()} title={t("c.q.del.title")} description={t("c.q.del.body")} confirmLabel={t("common.delete")} danger loading={busy} />
    </div>
  );
}
