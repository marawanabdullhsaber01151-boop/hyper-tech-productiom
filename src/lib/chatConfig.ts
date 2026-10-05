/** @format */
// Chat runtime config: one row in chat_settings, cached for 30s per instance
// (serverless: each instance refreshes itself; saving invalidates locally).
import { eq } from "drizzle-orm";
import { db } from "../db";
import { chatSettingsTable } from "../db/schema";
import { mergeChatConfig, type ChatConfig } from "./chatPolicy";

const TTL_MS = 30_000;
let cache: { value: ChatConfig; at: number } | null = null;

export async function getChatConfig(force = false): Promise<ChatConfig> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let value: ChatConfig;
  try {
    const [row] = await db
      .select({ config: chatSettingsTable.config })
      .from(chatSettingsTable)
      .where(eq(chatSettingsTable.id, 1))
      .limit(1);
    value = mergeChatConfig(row?.config as Partial<ChatConfig> | undefined);
  } catch {
    // الجدول غير موجود بعد (قبل الهجرة 0068) → الإعدادات الافتراضية
    value = mergeChatConfig(null);
  }
  cache = { value, at: Date.now() };
  return value;
}

export async function saveChatConfig(config: ChatConfig, userId: number) {
  await db
    .insert(chatSettingsTable)
    .values({ id: 1, config: config as unknown as Record<string, unknown>, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: chatSettingsTable.id,
      set: { config: config as unknown as Record<string, unknown>, updatedByUserId: userId, updatedAt: new Date() },
    });
  cache = { value: config, at: Date.now() };
}
