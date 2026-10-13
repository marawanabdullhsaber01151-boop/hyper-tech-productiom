import { useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Button, Dialog, Drawer, Field, InlineAlert, Input, Select, Skeleton, StatusPill, Textarea, Timeline, type Tone } from "../../design/components";
import { Pencil } from "../../design/icons";
import { useQuery } from "../../api/hooks";
import { formatDateTime, formatNumber } from "../../lib/format";
import { api } from "../api";
import { useAct } from "../act";
import { Row } from "../parts";
import type { AppDetail, AppMatches, AppMeta, AppRow } from "../types";
import { ageText, SlaPill, StagePill } from "./Applications";
import { ApprovalWizard } from "./ApprovalWizard";

const FIELDS = ["fullName", "companyName", "phone", "email", "address", "city", "commercialRegisterNo", "taxId", "expectedMonthlyVolume"] as const;
type Field_ = (typeof FIELDS)[number];
const OPEN = ["new", "needs_info", "ready"];
const CONF_TONE: Record<string, Tone> = { high: "danger", medium: "warn", low: "neutral" };

const fieldLabel = (k: string) => t(`a.ap.d.${k}` as CopyKey);
const evLabel = (k: string) => (k in KNOWN_EVENTS ? t(`a.ap.ev.${k}` as CopyKey) : t("a.ap.ev.other"));
const KNOWN_EVENTS: Record<string, 1> = { submitted: 1, auto_closed: 1, edited: 1, assigned: 1, note: 1, info_requested: 1, customer_replied: 1, rejected: 1, approved: 1 };
const evTone = (k: string): Tone => (k === "approved" ? "success" : k === "rejected" || k === "auto_closed" ? "danger" : k === "info_requested" ? "warn" : k === "customer_replied" ? "brand" : "neutral");

export interface WizardSeed {
  decision: "new_company" | "join_company" | "link_contact";
  companyId?: number;
  contactId?: number;
}

function MatchesPanel({ m, open, onSeed }: { m: AppMatches; open: boolean; onSeed: (s: WizardSeed) => void }) {
  const any = m.companies.length + m.contacts.length + m.applications.length > 0 || m.userPhoneTaken || m.userEmailTaken;
  if (!any) return <p class="ad-muted">{t("a.ap.d.matches.none")}</p>;
  const pills = (x: { reasons: Array<"phone" | "email" | "name">; confidence: string }) => (
    <div class="ad-pillrow">
      <StatusPill tone={CONF_TONE[x.confidence] ?? "neutral"}>{t(`a.ap.conf.${x.confidence}` as CopyKey)}</StatusPill>
      {x.reasons.map((r) => <StatusPill key={r} tone="neutral">{t(`a.ap.reason.${r}` as CopyKey)}</StatusPill>)}
    </div>
  );
  return (
    <div class="ad-stack">
      {m.userPhoneTaken ? <InlineAlert tone="warn">{t("a.ap.d.matches.phoneTaken")}</InlineAlert> : null}
      {m.userEmailTaken ? <InlineAlert tone="warn">{t("a.ap.d.matches.emailTaken")}</InlineAlert> : null}
      {m.companies.length ? <h4 class="ad-sub">{t("a.ap.d.matches.companies")}</h4> : null}
      {m.companies.map((c) => (
        <div class="ad-match" key={`c${c.id}`}>
          <strong>{c.name}</strong>
          <span class="ad-muted">{c.phone ? <bdi dir="ltr">{c.phone}</bdi> : null}</span>
          {pills(c)}
          {open ? <div><Button size="sm" variant="secondary" onClick={() => onSeed({ decision: "join_company", companyId: c.id })}>{t("a.ap.d.useJoin")}</Button></div> : null}
        </div>
      ))}
      {m.contacts.length ? <h4 class="ad-sub">{t("a.ap.d.matches.contacts")}</h4> : null}
      {m.contacts.map((c) => (
        <div class="ad-match" key={`k${c.id}`}>
          <strong>{c.name}</strong>
          <span class="ad-muted">{c.contactName}{c.phone ? <> · <bdi dir="ltr">{c.phone}</bdi></> : null}</span>
          {pills(c)}
          {c.alreadyLinked ? <StatusPill tone="info">{t("a.ap.d.linked")}</StatusPill> : open ? <div><Button size="sm" variant="secondary" onClick={() => onSeed({ decision: "link_contact", contactId: c.id })}>{t("a.ap.d.useLink")}</Button></div> : null}
        </div>
      ))}
      {m.applications.length ? <h4 class="ad-sub">{t("a.ap.d.matches.apps")}</h4> : null}
      {m.applications.map((a) => (
        <div class="ad-match" key={`a${a.id}`}>
          <strong>{a.name}</strong>
          <span class="ad-muted"><bdi dir="ltr">{a.referenceCode}</bdi></span>
          {pills(a)}
        </div>
      ))}
    </div>
  );
}

export function ApplicationDrawer({ id, meta, onClose, onChanged }: { id: number; meta?: AppMeta; onClose: () => void; onChanged: () => void }) {
  const { run, busy } = useAct();
  const q = useQuery((signal) => api.get<AppDetail>(`/portal-admin/applications/${id}`, { signal }), [id]);
  const d = q.data;
  const a = d?.application;
  const open = !!a && OPEN.includes(a.stage);

  const [dlg, setDlg] = useState<null | "info" | "reject" | "edit" | "approve">(null);
  const [waLink, setWaLink] = useState<string | null>(null);
  const [seed, setSeed] = useState<WizardSeed | null>(null);
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const reload = async () => {
    await q.refetch();
    onChanged();
  };
  const close = () => {
    setDlg(null);
    setText("");
  };

  const patch = async (body: Record<string, unknown>, ok = t("common.saved")) => {
    const r = await run(() => api.patch(`/portal-admin/applications/${id}`, body), ok);
    if (r !== undefined) await reload();
    return r !== undefined;
  };
  const sendInfo = async () => {
    const r = await run(() => api.post<{ whatsappUrl: string | null }>(`/portal-admin/applications/${id}/request-info`, { reason: text.trim() }), t("a.ap.info.sent"));
    if (r) {
      close();
      await reload();
      if (r.whatsappUrl) setWaLink(r.whatsappUrl);
    }
  };
  const reject = async () => {
    const r = await run(() => api.post(`/portal-admin/applications/${id}/reject`, { reason: text.trim() }), t("a.ap.reject.done"));
    if (r !== undefined) {
      close();
      await reload();
    }
  };
  const startEdit = (x: AppRow) => {
    setForm(Object.fromEntries(FIELDS.map((k) => [k, (x[k as keyof AppRow] as string | null) ?? ""])));
    setDlg("edit");
  };
  const saveEdit = async () => {
    const body: Record<string, unknown> = {};
    for (const k of FIELDS) body[k] = form[k]?.trim() ? form[k]!.trim() : null;
    if (await patch(body)) setDlg(null);
  };
  const templates = dlg === "info" ? meta?.infoTemplates : meta?.rejectTemplates;

  return (
    <Drawer open onClose={onClose} title={a ? a.companyName : t("common.loading")} description={a ? t("a.ap.d.title", { ref: a.referenceCode }) : undefined}>
      {q.error && !d ? (
        <InlineAlert tone="danger" title={t("a.ap.err.load")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert>
      ) : null}
      {!d && !q.error ? <div class="ad-stack"><Skeleton height={32} /><Skeleton height={140} /><Skeleton height={200} /></div> : null}
      {d && a ? (
        <div class="ad-stack">
          <div class="ad-pillrow">
            <StagePill stage={a.stage} />
            <SlaPill sla={a.sla} />
            <StatusPill tone="neutral">{formatNumber(a.completeness)}%</StatusPill>
            <span class="ad-muted">{ageText(a.ageHours)}</span>
          </div>

          {open ? (
            <div class="ad-row">
              <Button onClick={() => { setSeed(null); setDlg("approve"); }}>{t("a.ap.act.approve")}</Button>
              <Button variant="secondary" onClick={() => { setText(""); setDlg("info"); }}>{t("a.ap.act.info")}</Button>
              <Button variant="danger" onClick={() => { setText(""); setDlg("reject"); }}>{t("a.ap.act.reject")}</Button>
            </div>
          ) : (
            <InlineAlert tone="info">{t("a.ap.act.closed", { decision: a.decision ?? a.stage })}</InlineAlert>
          )}

          {a.reviewerNote ? <InlineAlert tone="info" title={t("a.ap.d.reviewerNote")}>{a.reviewerNote}</InlineAlert> : null}

          <section class="ad-stack" aria-labelledby="ap-data">
            <div class="ad-row ad-row--between">
              <h3 id="ap-data" class="ad-sub">{t("a.ap.d.data")}</h3>
              {open ? <Button size="sm" variant="ghost" icon={Pencil} onClick={() => startEdit(a)}>{t("a.ap.d.edit")}</Button> : null}
            </div>
            <dl class="ad-kvs">
              {FIELDS.map((k: Field_) => (
                <Row key={k} label={fieldLabel(k)}>{k === "phone" ? <bdi dir="ltr">{a.phone}</bdi> : ((a[k] as string | null) || <span class="ad-muted">—</span>)}</Row>
              ))}
              <Row label={t("a.ap.d.notes")}>{a.notes || <span class="ad-muted">—</span>}</Row>
            </dl>
            {a.missing.length ? <p class="ad-muted">{t("a.ap.d.missing", { list: a.missing.map(fieldLabel).join(t("a.ap.sep")) })}</p> : <p class="ad-muted">{t("a.ap.d.complete")}</p>}
          </section>

          <section class="ad-stack" aria-labelledby="ap-match">
            <h3 id="ap-match" class="ad-sub">{t("a.ap.d.matches")}</h3>
            <MatchesPanel m={d.matches} open={open} onSeed={(s) => { setSeed(s); setDlg("approve"); }} />
          </section>

          <section class="ad-stack" aria-labelledby="ap-assign">
            <h3 id="ap-assign" class="ad-sub">{t("a.ap.d.assign")}</h3>
            <Select
              aria-label={t("a.ap.d.assign")}
              value={a.assignedReviewerId ? String(a.assignedReviewerId) : ""}
              options={[{ value: "", label: t("a.ap.d.assign.none") }, ...(meta?.reviewers ?? []).map((u) => ({ value: String(u.id), label: u.fullName }))]}
              onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; void patch({ assignedReviewerId: v ? Number(v) : null }); }}
            />
            <Field label={t("a.ap.d.notes.internal")}>
              <Textarea rows={3} value={notes ?? a.internalNotes ?? ""} onInput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)} />
            </Field>
            <div>
              <Button size="sm" variant="secondary" loading={busy} disabled={notes === null || notes === (a.internalNotes ?? "")} onClick={async () => { if (await patch({ internalNotes: notes })) setNotes(null); }}>{t("a.ap.d.notes.save")}</Button>
            </div>
          </section>

          <section class="ad-stack" aria-labelledby="ap-hist">
            <h3 id="ap-hist" class="ad-sub">{t("a.ap.d.history")}</h3>
            {d.events.length ? (
              <Timeline items={d.events.map((e) => ({ id: e.id, title: evLabel(e.kind), meta: `${e.actorLabel.replace(/^staff:/, "")} · ${formatDateTime(e.createdAt)}`, body: e.note ?? undefined, tone: evTone(e.kind) }))} />
            ) : <p class="ad-muted">{t("a.ap.d.history.empty")}</p>}
          </section>
        </div>
      ) : null}

      <Dialog
        open={dlg === "info" || dlg === "reject"}
        onClose={close}
        title={dlg === "info" ? t("a.ap.info.title") : t("a.ap.reject.title")}
        description={dlg === "reject" ? t("a.ap.reject.body") : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={close}>{t("common.cancel")}</Button>
            {dlg === "info"
              ? <Button loading={busy} disabled={text.trim().length < 3} onClick={() => void sendInfo()}>{t("a.ap.info.send")}</Button>
              : <Button variant="danger" loading={busy} disabled={text.trim().length < 3} onClick={() => void reject()}>{t("a.ap.reject.confirm")}</Button>}
          </>
        }
      >
        <div class="ad-stack">
          {templates?.length ? (
            <Field label={t("a.ap.info.template")}>
              <Select value="" placeholder={t("a.ap.info.template.pick")} options={templates.map((x) => ({ value: x, label: x }))} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v) setText(v); }} />
            </Field>
          ) : null}
          <Field label={dlg === "info" ? t("a.ap.info.message") : t("a.ap.reject.reason")} required>
            <Textarea rows={4} value={text} onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} />
          </Field>
        </div>
      </Dialog>

      <Dialog open={!!waLink} onClose={() => setWaLink(null)} title={t("a.ap.info.sent")} size="sm" footer={<Button onClick={() => setWaLink(null)}>{t("common.done")}</Button>}>
        {waLink ? <a class="ht-btn ht-btn--secondary" href={waLink} target="_blank" rel="noopener noreferrer"><span class="ht-btn__label">{t("a.ap.info.wa")}</span></a> : null}
      </Dialog>

      <Dialog open={dlg === "edit"} onClose={close} title={t("a.ap.edit.title")} footer={<><Button variant="ghost" onClick={close}>{t("common.cancel")}</Button><Button loading={busy} onClick={() => void saveEdit()}>{t("common.save")}</Button></>}>
        <div class="ad-stack">
          {FIELDS.map((k) => (
            <Field key={k} label={fieldLabel(k)}>
              <Input value={form[k] ?? ""} dir={k === "phone" || k === "email" ? "ltr" : undefined} onInput={(e) => setForm({ ...form, [k]: (e.currentTarget as HTMLInputElement).value })} />
            </Field>
          ))}
        </div>
      </Dialog>

      {a && dlg === "approve" ? (
        <ApprovalWizard app={a} matches={d!.matches} meta={meta} seed={seed} onClose={() => setDlg(null)} onDone={reload} />
      ) : null}
    </Drawer>
  );
}
