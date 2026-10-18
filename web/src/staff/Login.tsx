import { useEffect, useState } from "preact/hooks";
import { api } from "../admin/api";
import { ApiError } from "../api/client";
import { navigate } from "../app/router";
import { staffSession } from "../auth/staffSession";
import type { StoredSession } from "../auth/session";
import { t } from "../copy";
import { Button, Field, IconButton, Input } from "../design/components";
import { Eye, EyeOff } from "../design/icons";
import { safeNext } from "./nav";
import "./StaffShell.css";

interface LoginOk extends StoredSession {
  user: { id: number; username: string; fullName: string; role: string };
}
interface TotpRequired {
  requiresTotp: true;
  preAuthToken: string;
}
type LoginReply = LoginOk | TotpRequired;

/** type guard صريح: LoginOk فيه index signature فـ"in" لوحدها مش بتفرّق الحالتين عند TypeScript. */
const isTotpStep = (r: LoginReply): r is TotpRequired => (r as TotpRequired).requiresTotp === true;

/** mm:ss بأرقام لاتينية. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** بعد الدخول: next لو جوّه الموقع (ممكن صفحة قديمة .html)، وإلا الرئيسية. */
function goAfterLogin() {
  const next = safeNext(new URLSearchParams(location.search).get("next"));
  if (next && (next === "/v2" || next.startsWith("/v2/"))) navigate(next.slice(3) || "/", { replace: true });
  else if (next) location.replace(next);
  else navigate("/staff", { replace: true });
}

export function Login() {
  const [step, setStep] = useState<"creds" | "totp">("creds");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [code, setCode] = useState("");
  const [preAuth, setPreAuth] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // جلسة شغّالة بالفعل؟ مفيش داعي لصفحة الدخول.
  useEffect(() => {
    if (staffSession.get()?.token) goAfterLogin();
  }, []);

  // عدّاد القفل
  useEffect(() => {
    if (lockedUntil === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);
  const remaining = lockedUntil === null ? 0 : Math.max(0, (lockedUntil - now) / 1000);
  const locked = lockedUntil !== null && remaining > 0;
  useEffect(() => {
    if (lockedUntil !== null && remaining <= 0) {
      setLockedUntil(null);
      setError(null);
    }
  }, [lockedUntil, remaining]);

  useEffect(() => {
    if (step === "totp") document.querySelector<HTMLInputElement>(".st-login__form input")?.focus();
  }, [step]);

  const finish = (r: LoginOk) => {
    staffSession.save(r);
    goAfterLogin();
  };

  const fail = (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.kind === "network") return setError(t("staff.login.err.network"));
      if (e.status === 423 || e.code === "ACCOUNT_LOCKED") {
        const secs = Number((e.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 0);
        if (secs > 0) {
          const t0 = Date.now();
          setNow(t0);
          setLockedUntil(t0 + secs * 1000);
          return setError(null);
        }
        return setError(e.message);
      }
      if (e.status === 401 && step === "creds") return setError(t("staff.login.err.creds"));
      return setError(e.message || t("staff.login.err.generic"));
    }
    setError(t("staff.login.err.generic"));
  };

  const submitCreds = async (ev: Event) => {
    ev.preventDefault();
    if (busy || locked) return;
    if (!username.trim() || !password) return setError(t("staff.login.err.required"));
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<LoginReply>("/auth/login", { username: username.trim(), password }, { anonymous: true });
      if (isTotpStep(r)) {
        setPreAuth(r.preAuthToken);
        setStep("totp");
      } else finish(r);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const submitTotp = async (ev: Event) => {
    ev.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      finish(await api.post<LoginOk>("/auth/login/verify-totp", { preAuthToken: preAuth, code: code.trim() }, { anonymous: true }));
    } catch (e) {
      // رسالة السيرفر واضحة بالعربي: «غير صحيح» أو «انتهت صلاحية جلسة التحقق».
      if (e instanceof ApiError && e.status === 401) setError(e.message || t("staff.totp.err"));
      else fail(e);
    } finally {
      setBusy(false);
    }
  };

  const backToCreds = () => {
    setStep("creds");
    setCode("");
    setPreAuth("");
    setError(null);
  };

  return (
    <div class="st-login">
      <div class="st-login__card">
        <div>
          <div class="st-login__brand">Hyper-Tech</div>
          <h1 class="ad-title">{step === "creds" ? t("staff.login.title") : t("staff.totp.title")}</h1>
          <p class="st-login__sub">{step === "creds" ? t("staff.login.subtitle") : t("staff.totp.hint")}</p>
        </div>
        {step === "creds" ? (
          <form class="st-login__form" onSubmit={submitCreds} noValidate>
            <Field label={t("staff.login.user")}>
              <Input value={username} autoComplete="username" autoCapitalize="none" spellcheck={false} autoFocus onInput={(e) => setUsername((e.currentTarget as HTMLInputElement).value)} />
            </Field>
            <div class="st-login__pass">
              <Field label={t("staff.login.pass")}>
                <Input type={show ? "text" : "password"} value={password} autoComplete="current-password" onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)} />
              </Field>
              <IconButton icon={show ? EyeOff : Eye} label={show ? t("staff.login.hide") : t("staff.login.show")} onClick={() => setShow((v) => !v)} />
            </div>
            <div class="st-login__err" role="alert">
              {locked ? t("staff.login.err.locked", { time: formatCountdown(remaining) }) : error}
            </div>
            <Button type="submit" block loading={busy} disabled={locked}>
              {busy ? t("staff.login.loading") : t("staff.login.submit")}
            </Button>
          </form>
        ) : (
          <form class="st-login__form" onSubmit={submitTotp} noValidate>
            <Field label={t("staff.totp.code")}>
              <Input value={code} inputMode="numeric" autoComplete="one-time-code" onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)} />
            </Field>
            <div class="st-login__err" role="alert">{error}</div>
            <Button type="submit" block loading={busy}>{t("staff.totp.submit")}</Button>
            <Button variant="ghost" block onClick={backToCreds}>{t("staff.totp.back")}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
