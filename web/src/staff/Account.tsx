import "../copy/settings";
import { useEffect, useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Dialog, Field, InlineAlert, Input, PasswordInput, StatusPill } from "../design/components";
import { formatDateTime } from "../lib/format";
import { qrSvg } from "../lib/qr";
import { EMPTY_PASSWORD, groupSecret, isTotpCode, passwordFormError, type PasswordForm, type TwoFaSetup, type TwoFaStatus } from "./settingsAdminCore";
import "./Activity.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;

/** حسابي: لكل موظف، تغيير كلمة السر والتحقق بخطوتين. */
export function Account() {
  return (
    <div class="ad-page">
      <div>
        <h1 class="ad-title">{t("acc.title")}</h1>
        <p class="st-login__sub">{t("acc.subtitle")}</p>
      </div>
      <PasswordCard />
      <TwoFaCard />
    </div>
  );
}

function PasswordCard() {
  const act = useAct();
  const [f, setF] = useState<PasswordForm>(EMPTY_PASSWORD);
  const [tried, setTried] = useState(false);
  const err = passwordFormError(f);
  const set = (k: keyof PasswordForm) => (e: Event) => setF({ ...f, [k]: val(e) });
  const msg = err ? t(`acc.pw.err.${err}` as CopyKey) : undefined;
  const at = (...codes: string[]) => (tried && err && codes.includes(err) ? msg : undefined);
  const submit = async () => {
    setTried(true);
    if (err) return;
    const ok = await act.run(async () => { await api.post<unknown>("/auth/change-password", { currentPassword: f.current, newPassword: f.next }); return true; }, t("acc.pw.done"));
    if (ok) { setF(EMPTY_PASSWORD); setTried(false); }
  };
  return (
    <section class="act-list" aria-labelledby="acc-pw">
      <h2 id="acc-pw">{t("acc.pw.title")}</h2>
      <Field label={t("acc.pw.current")} error={at("current")}><PasswordInput value={f.current} autocomplete="current-password" onInput={set("current")} /></Field>
      <Field label={t("acc.pw.next")} hint={t("acc.pw.hint")} error={at("short", "upper", "lower", "digit", "same")}><PasswordInput value={f.next} autocomplete="new-password" onInput={set("next")} /></Field>
      <Field label={t("acc.pw.confirm")} error={at("mismatch")}><PasswordInput value={f.confirm} autocomplete="new-password" onInput={set("confirm")} /></Field>
      <div class="act-toolbar"><Button loading={act.busy} onClick={() => void submit()}>{t("acc.pw.save")}</Button></div>
    </section>
  );
}

type Mode = "idle" | "setup" | "disable" | "regen";

function TwoFaCard() {
  const status = useQuery((signal) => api.get<TwoFaStatus>("/auth/2fa/status", { signal }), []);
  const act = useAct();
  const [mode, setMode] = useState<Mode>("idle");
  const [setup, setSetup] = useState<TwoFaSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const s = status.data;
  const start = async () => {
    const r = await act.run(() => api.post<TwoFaSetup>("/auth/2fa/setup", {}));
    if (r) { setSetup(r); setMode("setup"); }
  };
  const close = () => { setMode("idle"); setSetup(null); };
  return (
    <section class="act-list" aria-labelledby="acc-tfa">
      <h2 id="acc-tfa">{t("acc.tfa.title")}</h2>
      <p class="st-login__sub">{t("acc.tfa.intro")}</p>
      {status.error ? <InlineAlert tone="warn">{t("acc.loadFail")}</InlineAlert> : null}
      {s ? (
        <div class="act-toolbar">
          <StatusPill tone={s.totpEnabled ? "success" : "neutral"}>{t(s.totpEnabled ? "acc.tfa.on" : "acc.tfa.off")}</StatusPill>
          {s.totpEnabled && s.totpEnabledAt ? <span class="st-login__sub">{t("acc.tfa.since", { when: formatDateTime(s.totpEnabledAt) })}</span> : null}
          {s.totpEnabled ? (
            <>
              <Button variant="ghost" onClick={() => setMode("regen")}>{t("acc.tfa.regen")}</Button>
              <Button variant="ghost" onClick={() => setMode("disable")}>{t("acc.tfa.disable")}</Button>
            </>
          ) : <Button loading={act.busy} onClick={() => void start()}>{t("acc.tfa.start")}</Button>}
        </div>
      ) : null}
      {mode === "setup" && setup ? <SetupDialog setup={setup} onClose={close} onEnabled={async (c) => { close(); setCodes(c); await status.refetch(); }} /> : null}
      {mode === "disable" ? <PasswordDialog danger title={t("acc.tfa.disable")} warning={t("acc.tfa.disableConfirm")} onClose={close} run={async (password) => { await api.post<unknown>("/auth/2fa/disable", { password }); return true; }} done={t("acc.tfa.disableDone")} onDone={async () => { close(); await status.refetch(); }} /> : null}
      {mode === "regen" ? <PasswordDialog title={t("acc.tfa.regen")} onClose={close} run={async (password) => { const r = await api.post<{ backupCodes: string[] }>("/auth/2fa/regenerate-backup-codes", { password }); setCodes(r.backupCodes); return true; }} done={t("acc.tfa.regenDone")} onDone={async () => { close(); }} /> : null}
      <Dialog open={!!codes} onClose={() => setCodes(null)} title={t("acc.tfa.codesTitle")} footer={<Button onClick={() => setCodes(null)}>{t("acc.tfa.codesDone")}</Button>}>
        <InlineAlert tone="warn">{t("acc.tfa.codesWarn")}</InlineAlert>
        <ul class="act-list" dir="ltr" aria-label={t("acc.tfa.codesTitle")}>{(codes ?? []).map((c) => <li key={c}><code>{c}</code></li>)}</ul>
      </Dialog>
    </section>
  );
}

function SetupDialog({ setup, onClose, onEnabled }: { setup: TwoFaSetup; onClose: () => void; onEnabled: (codes: string[]) => Promise<void> }) {
  const act = useAct();
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => { void qrSvg(setup.otpauthUrl, { size: 180 }).then(setQr).catch(() => setQr(null)); }, [setup.otpauthUrl]);
  const submit = async () => {
    setTried(true);
    if (!isTotpCode(code)) return;
    const r = await act.run(() => api.post<{ backupCodes: string[] }>("/auth/2fa/confirm", { code: code.trim() }), t("acc.tfa.enabled"));
    if (r) await onEnabled(r.backupCodes);
  };
  return (
    <Dialog open onClose={onClose} title={t("acc.tfa.title")} footer={<><Button variant="ghost" onClick={onClose}>{t("acc.tfa.cancel")}</Button><Button loading={act.busy} onClick={() => void submit()}>{t("acc.tfa.confirm")}</Button></>}>
      <div class="act-list">
        <p class="st-login__sub">{t("acc.tfa.scan")}</p>
        {qr ? <div role="img" aria-label={t("acc.tfa.qr")} dangerouslySetInnerHTML={{ __html: qr }} /> : null}
        <code dir="ltr">{groupSecret(setup.secret)}</code>
        <Field label={t("acc.tfa.code")} error={tried && !isTotpCode(code) ? t("acc.tfa.err.code") : undefined}><Input inputMode="numeric" autocomplete="one-time-code" maxLength={6} dir="ltr" value={code} onInput={(e) => setCode(val(e))} /></Field>
      </div>
    </Dialog>
  );
}

/** نافذة بتطلب كلمة السر الحالية قبل إجراء حسّاس (تعطيل التحقق بخطوتين أو أكواد جديدة). */
function PasswordDialog({ title, warning, danger, run, done, onClose, onDone }: { title: string; warning?: string; danger?: boolean; run: (password: string) => Promise<boolean>; done: string; onClose: () => void; onDone: () => Promise<void> }) {
  const act = useAct();
  const [pw, setPw] = useState("");
  const [tried, setTried] = useState(false);
  const submit = async () => {
    setTried(true);
    if (!pw) return;
    const ok = await act.run(() => run(pw), done);
    if (ok) await onDone();
  };
  return (
    <Dialog open onClose={onClose} title={title} size="sm" footer={<><Button variant="ghost" onClick={onClose}>{t("acc.tfa.cancel")}</Button><Button variant={danger ? "danger" : "primary"} loading={act.busy} onClick={() => void submit()}>{title}</Button></>}>
      <div class="act-list">
        {warning ? <InlineAlert tone="warn">{warning}</InlineAlert> : null}
        <Field label={t("acc.tfa.password")} error={tried && !pw ? t("acc.tfa.err.password") : undefined}><PasswordInput value={pw} autocomplete="current-password" onInput={(e) => setPw(val(e))} /></Field>
      </div>
    </Dialog>
  );
}
