/** @format */
import { sendCustomerAlert } from "../otpDelivery";
import type { ChannelAdapter } from "./types";

export const smsAdapter: ChannelAdapter = {
  id: "sms",
  provider: "configured_http_provider",
  isConfigured: () =>
    Boolean(
      process.env.PORTAL_SMS_PROVIDER_API_KEY?.trim() &&
        process.env.PORTAL_SMS_PROVIDER_URL?.trim() &&
        (process.env.PORTAL_SMS_PROVIDER_FROM ?? process.env.PORTAL_SMS_FROM)?.trim(),
    ),
  async send(msg) {
    const r = await sendCustomerAlert({ channel: "phone", destination: msg.to, message: msg.text, event: "portal_channel_sms" });
    return r.delivered ? { ok: true } : { ok: false, errorCode: "provider_failed" };
  },
};
