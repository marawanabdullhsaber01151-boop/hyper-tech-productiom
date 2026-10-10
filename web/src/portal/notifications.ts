import { useEffect } from "preact/hooks";
import { api } from "./api";
import { createStore, useStore } from "./lib/store";

export const notifStore = createStore({ unread: 0 });
export const useUnread = () => useStore(notifStore).unread;

export async function refreshUnread() {
  try {
    const r = await api.get<{ count: number }>("/portal/notifications/unread-count");
    notifStore.set({ unread: r.count });
  } catch {
    /* العدّاد مش حرج */
  }
}

/** polling تكيّفي: 45 ثانية والتبويب ظاهر، 5 دقايق في الخلفية، وتحديث فوري لما يرجع. */
export function useUnreadPolling(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dead = false;
    const tick = async () => {
      await refreshUnread();
      if (!dead) timer = setTimeout(tick, document.hidden ? 300_000 : 45_000);
    };
    const onVis = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void tick();
      }
    };
    void tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      dead = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled]);
}
