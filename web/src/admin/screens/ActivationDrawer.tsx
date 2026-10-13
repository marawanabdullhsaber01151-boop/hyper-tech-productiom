import { useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Button, Dialog, Drawer, Field, Input, InlineAlert, Select, ShareLinkCard, Skeleton, StatusPill, Textarea, Timeline, type Tone } from "../../design/components";
import { useQuery } from "../../api/hooks";
import { formatDateTime, formatNumber } from "../../lib/format";
import { api } from "../api";
import { useAct } from "../act";
import { Row } from "../parts";
import type { ActActivation, ActCandidate, ActDetail, ActMeta } from "../types";
import { ActStatusPill, actLabel } from "./ActivationRequests";

const CONF_TONE: Record<string, Tone> = { high: "danger", medium: "warn", low: "neutral" };
const TTLS = ["60", "360", "1440", "4320"];
const KNOWN: Record<string, 1> = { submitted: 1, repeated: 1, assigned: 1, note: 1, confirmed: 1, rejected: 1, closed: 1, resent: 1 };
const evLabel = (k: string) => (k in KNOWN ? t(`a.ac.ev.${k}` as CopyKey) : t("a.ac.ev.other"));
const evTone = (k: string): Tone => (k === "confirmed" || k === "resent" ? "success" : k === "rejected" ? "danger" : k === "repeated" ? "warn" : "neutral");

function CandidateCard({ c, onPick, disabled }: { c: ActCandidate; onPick: (c: ActCandidate) => void; disabled: boolean }) {
  return (
    <div class="ad-match">
      <strong>{c.company || c.name}</strong>
      <span class="ad-muted">{c.name}{c.phone ? <> · <bdi dir="ltr">{c.phone}</bdi></> : null}</span>
      {c.confidence ? (
        <div class="ad-pillrow">
          <StatusPill tone={CONF_TONE[c.confidence] ?? "neutral"}>{t(`a.ac.conf.${c.confidence}` as CopyKey)}</StatusPill>
          {(c.reasons ?? []).map((r) => <StatusPill key={r} tone="neutral">{t(`a.ac.reason.${r}` as CopyKey)}</StatusPill>)}
        </div>
      ) : null}
      {c.alreadyLinked ? <StatusPill tone="info">{t("a.ac.d.linked")}</StatusPill> : disabled ? null : <div><Button size="sm" variant="secondary" onClick={() => onPick(c)}>{t("a.ac.d.confirmThis")}</Button></div>}
    </div>
  );
}

export function ActivationDrawer({ id, meta, onClose, onChanged }: { id: number; meta?: ActMeta; onClose: () => void; onChanged: () => void }) {
  const { run, busy } = useAct();
  const q = useQuery((signal) => api.get<ActDetail>(`/portal-admin/activation-requests/${id}`, { signal }), [id]);
  const d = q.data;
  const r = d?.request;
  const pending = r?.status === "pending";

  const [dlg, setDlg] = useState<null | "confirm" | "reject" | "close">(null);
  const [pick, setPick] = useState<ActCandidate | null>(null);
  const [ttl, setTtl] = useState("1440");
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<ActCandidate[] | null>(null);
  const [result, setResult] = useState<ActActivation | null>(null);

  const reload = async () => {
    await q.refetch();
    onChanged();
  };
  const closeDlg = () => {
    setDlg(null);
    setText("");
    setPick(null);
  };

  const patch = async (body: Record<string, unknown>) => {
    const ok = await run(() => api.patch(`/portal-admin/activation-requests/${id}`, body), t("common.saved"));
    if (ok !== undefined) await reload();
    return ok !== undefined;
  };
  const search = async () => {
    if (term.trim().length < 2) return;
    const res = await run(() => api.get<{ items: ActCandidate[] }>("/portal-admin/activation-requests/contacts/search", { query: { q: term.trim() } }));
    if (res) setFound(res.items);
  };
  const confirm = async () => {
    if (!pick) return;
    const res = await run(() => api.patch<{ activation: ActActivation }>(`/portal-activation-requests/${id}/confirm`, { contactId: pick.id, ttlMinutes: Number(ttl) }), t("a.ac.confirm.done"));
    if (res) {
      closeDlg();
      setResult(res.activation);
      await reload();
    }
  };
  const reject = async () => {
    const res = await run(() => api.patch(`/portal-activation-requests/${id}/reject`, { reason: text.trim() }), t("a.ac.reject.done"));
    if (res !== undefined) {
      closeDlg();
      await reload();
    }
  };
  const closeReq = async (reason: string) => {
    const res = await run(() => api.post(`/portal-admin/activation-requests/${id}/close`, { reason }), t("a.ac.close.done"));
    if (res !== undefined) {
      closeDlg();
      await reload();
    }
  };
  const resend = async () => {
    const res = await run(() => api.post<{ activation: ActActivation }>(`/portal-admin/activation-requests/${id}/resend`, {}), t("a.ac.resend.done"));
    if (res) {
      setResult(res.activation);
      await reload();
    }
  };
  const startPick = (c: ActCandidate) => {
    setPick(c);
    setDlg("confirm");
  };

  return (
    <Drawer open onClose={onClose} title={r ? r.companyNameEntered : t("common.loading")} description={r ? t("a.ac.d.title", { id: r.id }) : undefined}>
      {q.error && !d ? (
        <InlineAlert tone="danger" title={t("a.ac.err.load")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert>
      ) : null}
      {!d && !q.error ? <div class="ad-stack"><Skeleton height={32} /><Skeleton height={140} /><Skeleton height={200} /></div> : null}
      {d && r ? (
        <div class="ad-stack">
          <ActStatusPill r={r} />

          <section class="ad-stack" aria-labelledby="ac-entered">
            <h3 id="ac-entered" class="ad-sub">{t("a.ac.d.entered")}</h3>
            <dl class="ad-kvs">
              <Row label={t("a.ac.d.company")}>{r.companyNameEntered}</Row>
              <Row label={t("a.ac.d.phone")}><bdi dir="ltr">{r.phoneEntered}</bdi></Row>
            </dl>
            {r.requestCount > 1 ? <p class="ad-muted">{t("a.ac.d.repeat", { n: formatNumber(r.requestCount) })}</p> : null}
          </section>

          {d.existingAccount && pending ? (
            <InlineAlert tone="warn" action={<Button size="sm" variant="secondary" onClick={() => void closeReq(t("a.ac.d.exists.reason"))}>{t("a.ac.d.exists.close")}</Button>}>
              {t("a.ac.d.exists", { name: d.existingAccount.companyName })}
            </InlineAlert>
          ) : null}

          {pending ? (
            <>
              <section class="ad-stack" aria-labelledby="ac-cands">
                <h3 id="ac-cands" class="ad-sub">{t("a.ac.d.candidates")}</h3>
                {d.candidates.length ? d.candidates.map((c) => <CandidateCard key={c.id} c={c} onPick={startPick} disabled={false} />) : <p class="ad-muted">{t("a.ac.d.candidates.none")}</p>}
              </section>

              <section class="ad-stack" aria-labelledby="ac-manual">
                <h3 id="ac-manual" class="ad-sub">{t("a.ac.d.manual")}</h3>
                <form class="ad-row" onSubmit={(e) => { e.preventDefault(); void search(); }}>
                  <Input aria-label={t("a.ac.d.manual")} placeholder={t("a.ac.d.manual.hint")} value={term} onInput={(e) => setTerm((e.currentTarget as HTMLInputElement).value)} />
                  <Button type="submit" variant="secondary" loading={busy} disabled={term.trim().length < 2}>{t("common.search")}</Button>
                </form>
                {found ? (found.length ? found.map((c) => <CandidateCard key={c.id} c={c} onPick={startPick} disabled={false} />) : <p class="ad-muted">{t("a.ac.d.manual.none")}</p>) : null}
              </section>

              <section class="ad-stack" aria-labelledby="ac-act">
                <h3 id="ac-act" class="ad-sub">{t("a.ac.d.actions")}</h3>
                <div class="ad-row">
                  <Button variant="danger" onClick={() => { setText(""); setDlg("reject"); }}>{t("a.ac.d.reject")}</Button>
                  <Button variant="secondary" onClick={() => { setText(""); setDlg("close"); }}>{t("a.ac.d.close")}</Button>
                </div>
              </section>
            </>
          ) : (
            <div class="ad-stack">
              <InlineAlert tone="info">{t("a.ac.d.closedInfo", { status: actLabel(r.status) })}{r.rejectionReason || r.closeReason ? <> — {t("a.ac.d.reason.shown", { reason: (r.rejectionReason || r.closeReason)! })}</> : null}</InlineAlert>
              {r.status === "confirmed" && r.matchedPortalCustomerId ? <div><Button variant="secondary" loading={busy} onClick={() => void resend()}>{t("a.ac.d.resend")}</Button></div> : null}
            </div>
          )}

          <section class="ad-stack" aria-labelledby="ac-assign">
            <h3 id="ac-assign" class="ad-sub">{t("a.ac.d.assign")}</h3>
            <Select
              aria-label={t("a.ac.d.assign")}
              value={r.assignedReviewerId ? String(r.assignedReviewerId) : ""}
              options={[{ value: "", label: t("a.ac.d.assign.none") }, ...(meta?.reviewers ?? []).map((u) => ({ value: String(u.id), label: u.fullName }))]}
              onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; void patch({ assignedReviewerId: v ? Number(v) : null }); }}
            />
            <Field label={t("a.ac.d.notes")}>
              <Textarea rows={3} value={notes ?? r.internalNotes ?? ""} onInput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)} />
            </Field>
            <div>
              <Button size="sm" variant="secondary" loading={busy} disabled={notes === null || notes === (r.internalNotes ?? "")} onClick={async () => { if (await patch({ internalNotes: notes })) setNotes(null); }}>{t("a.ac.d.notes.save")}</Button>
            </div>
          </section>

          <section class="ad-stack" aria-labelledby="ac-hist">
            <h3 id="ac-hist" class="ad-sub">{t("a.ac.d.history")}</h3>
            {d.events.length ? (
              <Timeline items={d.events.map((e) => ({ id: e.id, title: evLabel(e.kind), meta: `${e.actorLabel.replace(/^staff:/, "")} · ${formatDateTime(e.createdAt)}`, body: e.note ?? undefined, tone: evTone(e.kind) }))} />
            ) : <p class="ad-muted">{t("a.ac.d.history.empty")}</p>}
          </section>
        </div>
      ) : null}

      <Dialog open={dlg === "confirm"} onClose={closeDlg} title={t("a.ac.confirm.title")} description={pick ? t("a.ac.confirm.body", { name: pick.company || pick.name }) : undefined}
        footer={<><Button variant="ghost" onClick={closeDlg}>{t("common.cancel")}</Button><Button loading={busy} onClick={() => void confirm()}>{t("a.ac.confirm.go")}</Button></>}>
        <Field label={t("a.ac.confirm.ttl")}>
          <Select value={ttl} options={TTLS.map((v) => ({ value: v, label: t(`a.ac.ttl.${v}` as CopyKey) }))} onChange={(e) => setTtl((e.currentTarget as HTMLSelectElement).value)} />
        </Field>
      </Dialog>

      <Dialog open={dlg === "reject" || dlg === "close"} onClose={closeDlg}
        title={dlg === "reject" ? t("a.ac.reject.title") : t("a.ac.close.title")}
        description={dlg === "reject" ? t("a.ac.reject.body") : t("a.ac.close.body")}
        footer={<><Button variant="ghost" onClick={closeDlg}>{t("common.cancel")}</Button>
          {dlg === "reject"
            ? <Button variant="danger" loading={busy} disabled={text.trim().length < 2} onClick={() => void reject()}>{t("a.ac.reject.confirm")}</Button>
            : <Button loading={busy} disabled={text.trim().length < 2} onClick={() => void closeReq(text.trim())}>{t("a.ac.close.confirm")}</Button>}</>}>
        <Field label={dlg === "reject" ? t("a.ac.reject.reason") : t("a.ac.close.reason")} required>
          <Textarea rows={3} value={text} onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} />
        </Field>
      </Dialog>

      <Dialog open={!!result} onClose={() => setResult(null)} title={t("a.ac.confirm.done")} footer={<Button onClick={() => setResult(null)}>{t("common.done")}</Button>}>
        {result ? (
          <div class="ad-stack">
            <InlineAlert tone={result.delivered ? "success" : "warn"}>{result.delivered ? t("a.ap.w.done.sent") : t("a.ap.w.done.notSent")}</InlineAlert>
            <ShareLinkCard url={result.url} title={t("a.ap.w.done.link")} whatsappPhone={r?.phoneEntered} whatsappText={result.message} />
            <p class="ad-muted">{t("a.ap.w.done.linkNote")}</p>
          </div>
        ) : null}
      </Dialog>
    </Drawer>
  );
}
