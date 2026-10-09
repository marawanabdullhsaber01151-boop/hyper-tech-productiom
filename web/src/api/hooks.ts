import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ApiError } from "./client";

export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  /** بيعيد الطلب من غير ما يمسح البيانات القديمة. */
  refetch: () => Promise<void>;
}

/** جلب بيانات مع إلغاء الطلب القديم لما المفاتيح تتغيّر. */
export function useQuery<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[] = []): QueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);
  const ctl = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    const id = ++seq.current;
    setLoading(true);
    try {
      const d = await fetcherRef.current(c.signal);
      if (id !== seq.current) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (id !== seq.current || (e as Error)?.name === "AbortError") return;
      setError(e instanceof ApiError ? e : new ApiError({ kind: "other", status: 0, code: "UNKNOWN", message: (e as Error)?.message ?? "" }));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    return () => ctl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refetch: run };
}

export interface MutationState<A, R> {
  mutate: (arg: A) => Promise<R | undefined>;
  loading: boolean;
  error: ApiError | null;
  reset: () => void;
}

/** تنفيذ تغيير (POST/PUT...). بيمنع الضغط المزدوج: لو في طلب شغّال بيتجاهل الجديد. */
export function useMutation<A, R>(fn: (arg: A) => Promise<R>): MutationState<A, R> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const busy = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const mutate = useCallback(async (arg: A) => {
    if (busy.current) return undefined;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      return await fnRef.current(arg);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError({ kind: "other", status: 0, code: "UNKNOWN", message: (e as Error)?.message ?? "" }));
      return undefined;
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);
  return { mutate, loading, error, reset: () => setError(null) };
}
