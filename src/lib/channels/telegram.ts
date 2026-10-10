/** @format */
import type { ChannelAdapter } from "./types";

const TIMEOUT_MS = 10_000;

export function telegramBotToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
}
export function telegramBotUsername(fallback = "HyperTechPortalBot"): string {
  return (process.env.TELEGRAM_BOT_USERNAME?.trim() || fallback).replace(/^@/, "");
}

export async function telegramSend(chatId: string, text: string): Promise<{ ok: boolean; errorCode?: string }> {
  const token = telegramBotToken();
  if (!token) return { ok: false, errorCode: "not_configured" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: ctrl.signal,
    });
    return res.ok ? { ok: true } : { ok: false, errorCode: `http_${res.status}` };
  } catch {
    return { ok: false, errorCode: "request_failed" };
  } finally {
    clearTimeout(t);
  }
}

export const telegramAdapter: ChannelAdapter = {
  id: "telegram",
  provider: "telegram_bot",
  isConfigured: () => Boolean(telegramBotToken()),
  send: (msg) => telegramSend(msg.to, msg.text),
};
