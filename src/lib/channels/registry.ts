/** @format */
import { emailAdapter } from "./email";
import { smsAdapter } from "./sms";
import { telegramAdapter } from "./telegram";
import type { ChannelAdapter, ChannelId } from "./types";

const real: Record<Exclude<ChannelId, "whatsapp_manual">, ChannelAdapter> = {
  email: emailAdapter,
  telegram: telegramAdapter,
  sms: smsAdapter,
};
const overrides = new Map<ChannelId, ChannelAdapter>();

/** Tests only. Refuses to run in production so a fake can never claim delivery there. */
export function setChannelAdapterOverride(id: ChannelId, adapter: ChannelAdapter | null): void {
  if (process.env.NODE_ENV === "production") throw new Error("adapter override is not allowed in production");
  if (adapter) overrides.set(id, adapter);
  else overrides.delete(id);
}

export function getChannelAdapter(id: Exclude<ChannelId, "whatsapp_manual">): ChannelAdapter {
  return overrides.get(id) ?? real[id];
}

/** What the admin screen may show: configured or not. Never secrets. */
export function channelStatus(): Array<{ id: ChannelId; configured: boolean; provider: string }> {
  return [
    ...(["email", "telegram", "sms"] as const).map((id) => {
      const a = getChannelAdapter(id);
      return { id, configured: a.isConfigured(), provider: a.provider };
    }),
    { id: "whatsapp_manual" as const, configured: true, provider: "wa.me" },
  ];
}
