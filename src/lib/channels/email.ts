/** @format */
import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "../logger";
import type { AdapterResult, ChannelAdapter, OutgoingMessage } from "./types";

const TIMEOUT_MS = 12_000;

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function emailProviderName(): "smtp" | "brevo" | "resend" {
  const p = (env("EMAIL_PROVIDER") ?? "smtp").toLowerCase();
  return p === "brevo" || p === "resend" ? p : "smtp";
}

function fromAddress(): string | undefined {
  return env("EMAIL_FROM") ?? env("SMTP_FROM");
}

function configured(): boolean {
  const from = fromAddress();
  if (!from) return false;
  const p = emailProviderName();
  if (p === "smtp") return Boolean(env("SMTP_HOST"));
  return Boolean(env("EMAIL_API_KEY"));
}

async function viaHttp(provider: "brevo" | "resend", msg: OutgoingMessage): Promise<AdapterResult> {
  const key = env("EMAIL_API_KEY")!;
  const from = fromAddress()!;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res =
      provider === "brevo" ?
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": key, "content-type": "application/json" },
          body: JSON.stringify({
            sender: parseFrom(from),
            to: [{ email: msg.to }],
            subject: msg.subject ?? "Hyper-Tech",
            textContent: msg.text,
          }),
          signal: ctrl.signal,
        })
      : await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ from, to: [msg.to], subject: msg.subject ?? "Hyper-Tech", text: msg.text }),
          signal: ctrl.signal,
        });
    return res.ok ? { ok: true } : { ok: false, errorCode: `http_${res.status}` };
  } catch {
    return { ok: false, errorCode: "request_failed" };
  } finally {
    clearTimeout(t);
  }
}

function parseFrom(from: string): { name?: string; email: string } {
  const m = /^(.*)<([^>]+)>$/.exec(from.trim());
  return m ? { name: m[1]!.trim().replace(/^"|"$/g, ""), email: m[2]!.trim() } : { email: from.trim() };
}

let smtp: Transporter | null = null;
function transporter(): Transporter {
  if (smtp) return smtp;
  const port = Number(env("SMTP_PORT") ?? 587);
  const secure = (env("SMTP_SECURE") ?? (port === 465 ? "true" : "false")) === "true";
  const user = env("SMTP_USER");
  smtp = nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port,
    secure,
    auth: user ? { user, pass: process.env.SMTP_PASS ?? "" } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  return smtp;
}

/** Test hook: forget the cached SMTP transport after env changes. */
export function resetEmailTransport(): void {
  smtp = null;
}

export const emailAdapter: ChannelAdapter = {
  id: "email",
  get provider() {
    return emailProviderName();
  },
  isConfigured: configured,
  async send(msg) {
    if (!configured()) return { ok: false, errorCode: "not_configured" };
    const p = emailProviderName();
    if (p !== "smtp") return viaHttp(p, msg);
    try {
      await transporter().sendMail({
        from: fromAddress(),
        to: msg.to,
        subject: msg.subject ?? "Hyper-Tech",
        text: msg.text,
      });
      return { ok: true };
    } catch (e) {
      // never log the message or the address — only the failure class
      logger.warn("Portal email not delivered", {
        provider: "smtp",
        errorClass: (e as { code?: string })?.code ?? "smtp_error",
      });
      return { ok: false, errorCode: String((e as { code?: string })?.code ?? "smtp_error").toLowerCase() };
    }
  },
};
