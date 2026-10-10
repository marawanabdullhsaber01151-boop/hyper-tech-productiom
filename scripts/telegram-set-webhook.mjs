#!/usr/bin/env node
/**
 * Registers (or removes) the Telegram webhook for the portal bot.
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-set-webhook.mjs https://YOUR-DOMAIN
 *   node scripts/telegram-set-webhook.mjs --remove
 * The bot token and secret are read from the environment and never printed.
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const arg = process.argv[2];
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN مش متظبط.");
  process.exit(1);
}
const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());

if (arg === "--remove") {
  const r = await api("deleteWebhook", { drop_pending_updates: true });
  console.log(r.ok ? "اتشال الـ webhook." : `فشل: ${r.description}`);
  process.exit(r.ok ? 0 : 1);
}
if (!arg || !/^https:\/\//.test(arg)) {
  console.error("اكتب رابط الموقع كامل بـ https، مثال: node scripts/telegram-set-webhook.mjs https://example.vercel.app");
  process.exit(1);
}
if (!secret || secret.length < 16) {
  console.error("TELEGRAM_WEBHOOK_SECRET لازم يتظبط (16 حرف على الأقل).");
  process.exit(1);
}
const url = `${arg.replace(/\/$/, "")}/api/v1/portal/telegram/webhook`;
const r = await api("setWebhook", { url, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true });
console.log(r.ok ? `الـ webhook اتظبط على: ${url}` : `فشل: ${r.description}`);
const info = await api("getWebhookInfo");
console.log(`آخر خطأ عند تيليجرام: ${info.result?.last_error_message ?? "لا يوجد"}`);
process.exit(r.ok ? 0 : 1);
