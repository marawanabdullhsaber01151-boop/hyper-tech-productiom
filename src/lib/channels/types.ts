/** @format */
export type ChannelId = "email" | "telegram" | "sms" | "whatsapp_manual";

export type OutgoingMessage = {
  /** email address / telegram chat id / phone */
  to: string;
  subject?: string;
  text: string;
};

export type AdapterResult = { ok: boolean; errorCode?: string };

export interface ChannelAdapter {
  readonly id: ChannelId;
  readonly provider: string;
  isConfigured(): boolean;
  send(msg: OutgoingMessage): Promise<AdapterResult>;
}

export function maskAddress(channel: ChannelId, value: string): string {
  if (channel === "email") {
    const [l = "", d = ""] = value.split("@");
    return `${l.slice(0, 1) || "*"}***@${d}`;
  }
  if (channel === "telegram") return "تيليجرام";
  return `***${value.replace(/\D/g, "").slice(-3)}`;
}
