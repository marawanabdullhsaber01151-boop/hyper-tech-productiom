import { useEffect } from "preact/hooks";
import { api } from "./api";
import { createStore, useStore } from "./lib/store";

export const chatUnreadStore = createStore({ unread: 0 });
export const useChatUnread = () => useStore(chatUnreadStore).unread;

/** عدّاد رسايل المحادثة الجديدة للأيقونة (كل 30 ثانية والتبويب ظاهر). */
export function useChatUnreadPolling(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const r = await api.get<{ unread: number }>("/portal/chat/summary");
          chatUnreadStore.set({ unread: r.unread });
        } catch {
          /* مش حرج */
        }
      }
      if (!dead) timer = setTimeout(tick, 30_000);
    };
    void tick();
    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [enabled]);
}
