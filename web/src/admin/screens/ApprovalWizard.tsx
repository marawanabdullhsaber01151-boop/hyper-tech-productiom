import { useState } from "preact/hooks";
import { t, type CopyKey } from "../../copy";
import { Button, CopyField, Dialog, Field, Input, InlineAlert, Radio, Select, ShareLinkCard, StepWizard, type WizardStep } from "../../design/components";
import { navigate } from "../../app/router";
import { api } from "../api";
import { useAct } from "../act";
import { optLabel } from "../SettingField";
import type { AppMatches, AppMeta, AppRow, ApproveResult } from "../types";
import type { WizardSeed } from "./ApplicationDrawer";

type Decision = "new_company" | "join_company" | "link_contact";
const JOIN_MODES = ["approval", "auto", "disabled"];
const CHAT_MODES = ["shared", "per_member", "per_member_monitored"];

export function ApprovalWizard({ app, matches, meta, seed, onClose, onDone }: { app: AppRow; matches: AppMatches; meta?: AppMeta; seed: WizardSeed | null; onClose: () => void; onDone: () => void | Promise<void> }) {
  const { run, busy } = useAct();
  const defaults = meta?.defaults;
  const [step, setStep] = useState(0);
  const [decision, setDecision] = useState<Decision>(seed?.decision ?? "new_company");
  const [companyId, setCompanyId] = useState(seed?.companyId ? String(seed.companyId) : "");
  const [contactId, setContactId] = useState(seed?.contactId ? String(seed.contactId) : "");
  const [roleKey, setRoleKey] = useState("");
  const [maxMembers, setMaxMembers] = useState("");
  const [joinMode, setJoinMode] = useState("");
  const [chatMode, setChatMode] = useState("");
  const [sales, setSales] = useState("");
  const [segment, setSegment] = useState("");
  const [minQty, setMinQty] = useState("");
  const [result, setResult] = useState<ApproveResult | null>(null);

  const pickValid = decision === "join_company" ? Number(companyId) > 0 : decision === "link_contact" ? Number(contactId) > 0 : true;

  /** بنبعت بس اللي المستخدم غيّره (السيرفر بيتجاهل أي قيمة زي الافتراضي). */
  const setup = () => {
    const s: Record<string, unknown> = {};
    if (decision === "join_company") return s;
    if (maxMembers) s.maxMembers = Number(maxMembers);
    if (joinMode) s.joinMode = joinMode;
    if (chatMode) s.chatMode = chatMode;
    if (roleKey.trim()) s.defaultRole = roleKey.trim();
    if (sales) s.assignedSalesUserId = Number(sales);
    if (segment) s.segment = segment;
    if (minQty) s.minOrderQty = Number(minQty);
    return s;
  };
  const setupList = () => {
    const s = setup();
    const names: Record<string, string> = { maxMembers: t("a.ap.w.max"), joinMode: t("a.ap.w.join"), chatMode: t("a.ap.w.chat"), defaultRole: t("a.ap.w.role"), assignedSalesUserId: t("a.ap.w.sales"), segment: t("a.ap.w.segment"), minOrderQty: t("a.ap.w.minQty") };
    return Object.keys(s).map((k) => names[k]!).join(t("a.ap.sep"));
  };

  const finish = async () => {
    const body: Record<string, unknown> = { decision, setup: setup() };
    if (decision === "join_company") {
      body.companyId = Number(companyId);
      if (roleKey.trim()) body.roleKey = roleKey.trim();
    }
    if (decision === "link_contact") body.contactId = Number(contactId);
    const r = await run(() => api.post<ApproveResult>(`/portal-admin/applications/${app.id}/approve`, body));
    if (r) {
      setResult(r);
      await onDone();
    }
  };

  const choice = (value: Decision, title: string, hint: string, extra?: preact.ComponentChildren) => (
    <div class="ad-choice" data-on={decision === value}>
      <Radio name="ap-decision" label={title} hint={hint} checked={decision === value} onChange={() => setDecision(value)} />
      {decision === value ? extra : null}
    </div>
  );
  const companyOpts = matches.companies.map((c) => ({ value: String(c.id), label: `${c.name} (#${c.id})` }));
  const contactOpts = matches.contacts.filter((c) => !c.alreadyLinked).map((c) => ({ value: String(c.id), label: `${c.name} (#${c.id})` }));

  const idPicker = (opts: Array<{ value: string; label: string }>, value: string, set: (v: string) => void, pickLabel: string, manualLabel: string) =>
    opts.length ? (
      <Field label={pickLabel}>
        <Select value={value} placeholder={t("a.ap.w.pick.placeholder")} options={opts} onChange={(e) => set((e.currentTarget as HTMLSelectElement).value)} />
      </Field>
    ) : (
      <Field label={manualLabel} hint={t("a.ap.w.pick.none")}>
        <Input inputMode="numeric" dir="ltr" value={value} onInput={(e) => set((e.currentTarget as HTMLInputElement).value.replace(/\D/g, ""))} />
      </Field>
    );

  const hint = (v: string | number | undefined) => (v === undefined ? undefined : t("a.ap.w.default", { v: String(v) }));
  const steps: WizardStep[] = [
    {
      id: "decision",
      title: t("a.ap.w.step.decision"),
      valid: pickValid,
      content: (
        <div class="ad-stack">
          {choice("new_company", t("a.ap.w.decision.new"), t("a.ap.w.decision.new.hint"))}
          {choice("join_company", t("a.ap.w.decision.join"), t("a.ap.w.decision.join.hint"), idPicker(companyOpts, companyId, setCompanyId, t("a.ap.w.pickCompany"), t("a.ap.w.pick.manualCompany")))}
          {choice("link_contact", t("a.ap.w.decision.link"), t("a.ap.w.decision.link.hint"), idPicker(contactOpts, contactId, setContactId, t("a.ap.w.pickContact"), t("a.ap.w.pick.manualContact")))}
        </div>
      ),
    },
    {
      id: "setup",
      title: t("a.ap.w.step.setup"),
      content:
        decision === "join_company" ? (
          <div class="ad-stack">
            <Field label={t("a.ap.w.role")} hint={defaults ? t("a.ap.w.role.hint", { v: defaults.defaultRole }) : undefined}>
              <Input dir="ltr" value={roleKey} onInput={(e) => setRoleKey((e.currentTarget as HTMLInputElement).value)} />
            </Field>
          </div>
        ) : (
          <div class="ad-stack">
            <p class="ad-muted">{t("a.ap.w.setup.hint")}</p>
            <div class="ad-grid2">
              <Field label={t("a.ap.w.max")} hint={hint(defaults?.maxMembers)}>
                <Input type="number" inputMode="numeric" min={1} value={maxMembers} onInput={(e) => setMaxMembers((e.currentTarget as HTMLInputElement).value)} />
              </Field>
              <Field label={t("a.ap.w.minQty")} hint={hint(defaults?.minOrderQty)}>
                <Input type="number" inputMode="numeric" min={1} value={minQty} onInput={(e) => setMinQty((e.currentTarget as HTMLInputElement).value)} />
              </Field>
              <Field label={t("a.ap.w.join")} hint={hint(defaults ? optLabel(defaults.joinMode) : undefined)}>
                <Select value={joinMode} placeholder={t("a.ap.w.segment.none")} options={JOIN_MODES.map((o) => ({ value: o, label: optLabel(o) }))} onChange={(e) => setJoinMode((e.currentTarget as HTMLSelectElement).value)} />
              </Field>
              <Field label={t("a.ap.w.chat")} hint={hint(defaults ? optLabel(defaults.chatMode) : undefined)}>
                <Select value={chatMode} placeholder={t("a.ap.w.segment.none")} options={CHAT_MODES.map((o) => ({ value: o, label: optLabel(o) }))} onChange={(e) => setChatMode((e.currentTarget as HTMLSelectElement).value)} />
              </Field>
              <Field label={t("a.ap.w.sales")}>
                <Select value={sales} placeholder={t("a.ap.w.sales.none")} options={(meta?.reviewers ?? []).map((u) => ({ value: String(u.id), label: u.fullName }))} onChange={(e) => setSales((e.currentTarget as HTMLSelectElement).value)} />
              </Field>
              <Field label={t("a.ap.w.segment")}>
                <Select value={segment} placeholder={t("a.ap.w.segment.none")} options={(meta?.segments ?? []).map((o) => ({ value: o, label: optLabel(o) }))} onChange={(e) => setSegment((e.currentTarget as HTMLSelectElement).value)} />
              </Field>
            </div>
          </div>
        ),
    },
    {
      id: "confirm",
      title: t("a.ap.w.step.confirm"),
      content: (
        <div class="ad-stack">
          <dl class="ad-kvs">
            <div class="ad-kv"><dt>{t("a.ap.w.sum.decision")}</dt><dd>{t(decision === "new_company" ? "a.ap.w.decision.new" : decision === "join_company" ? "a.ap.w.decision.join" : "a.ap.w.decision.link")}</dd></div>
            <div class="ad-kv"><dt>{t("a.ap.w.sum.target")}</dt><dd>{decision === "new_company" ? t("a.ap.w.sum.new", { name: app.companyName }) : decision === "join_company" ? `#${companyId}` : `#${contactId}`}</dd></div>
            <div class="ad-kv"><dt>{t("a.ap.d.fullName")}</dt><dd>{app.fullName} · <bdi dir="ltr">{app.phone}</bdi></dd></div>
          </dl>
          <p>{setupList() ? t("a.ap.w.sum.setup", { list: setupList() }) : t("a.ap.w.sum.setup.none")}</p>
          <InlineAlert tone="warn">{t("a.ap.w.sum.note")}</InlineAlert>
        </div>
      ),
    },
  ];

  const resultView = result ? (
    <div class="ad-stack">
      {result.activation ? (
        <>
          <InlineAlert tone={result.activation.delivered ? "success" : "warn"}>{result.activation.delivered ? t("a.ap.w.done.sent") : t("a.ap.w.done.notSent")}</InlineAlert>
          <ShareLinkCard url={result.activation.url} title={t("a.ap.w.done.link")} whatsappPhone={app.phone} whatsappText={result.activation.message} />
          <p class="ad-muted">{t("a.ap.w.done.linkNote")}</p>
        </>
      ) : (
        <>
          <CopyField value={result.tempPassword ?? ""} label={t("a.ap.w.done.pass")} />
          <p class="ad-muted">{t("a.ap.w.done.passNote")}</p>
          {result.whatsappUrl ? <a class="ht-btn ht-btn--secondary" href={result.whatsappUrl} target="_blank" rel="noopener noreferrer"><span class="ht-btn__label">{t("a.ap.w.done.wa")}</span></a> : null}
        </>
      )}
    </div>
  ) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={result ? t("a.ap.w.done.title") : t("a.ap.w.title")}
      footer={result ? <><Button variant="secondary" onClick={() => navigate(`/admin/portal-customers/${result.companyId}`)}>{t("a.ap.w.done.open")}</Button><Button onClick={onClose}>{t("common.done")}</Button></> : undefined}
    >
      {resultView ?? <StepWizard steps={steps} current={step} onChange={setStep} onFinish={() => void finish()} finishing={busy} finishLabel={t("a.ap.w.finish")} />}
    </Dialog>
  );
}
