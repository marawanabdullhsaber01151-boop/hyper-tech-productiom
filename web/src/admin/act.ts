import { useRef, useState } from "preact/hooks";
import { useToast } from "../design/components";

/** بينفّذ إجراء، يعرض نجاحه أو خطأه كـ Toast، ويمنع الضغط المزدوج. */
export function useAct() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    if (lock.current) return undefined;
    lock.current = true;
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast({ tone: "success", message: ok });
      return r;
    } catch (e) {
      toast({ tone: "danger", message: (e as Error).message });
      return undefined;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { run, busy };
}
