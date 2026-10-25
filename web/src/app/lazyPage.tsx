import { useEffect, useState } from "preact/hooks";
import type { ComponentType } from "preact";
import { Spinner } from "../design/components";

/** بنحمّل صفحة الموظفين عند الطلب بس، عشان الحزمة الأساسية تفضل خفيفة مهما زادت الصفحات. */
export function LazyPage<P extends object>({ load, props }: { load: () => Promise<ComponentType<P>>; props: P }) {
  const [C, setC] = useState<ComponentType<P> | null>(null);
  useEffect(() => {
    let alive = true;
    setC(null);
    void load().then((c) => alive && setC(() => c));
    return () => {
      alive = false;
    };
  }, [load]);
  return C ? <C {...props} /> : <Spinner />;
}
