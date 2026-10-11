import { useCallback } from "preact/hooks";
import { navigate, usePath } from "../app/router";

/** حالة الصفحة كلها في الـ URL (قابلة للمشاركة). بنقرا location.search مباشرة، وusePath بيعيد الرسم لما يتغيّر. */
export function useUrlParams() {
  usePath();
  const params = new URLSearchParams(location.search);
  const get = (k: string, d = "") => params.get(k) ?? d;
  const base = location.pathname.replace(/^\/v2/, "");
  const set = useCallback(
    (patch: Record<string, string | undefined>, opts: { resetPage?: boolean } = {}) => {
      const next = new URLSearchParams(location.search);
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (opts.resetPage) next.delete("page");
      const qs = next.toString();
      navigate(base + (qs ? `?${qs}` : ""), { replace: true });
    },
    [base],
  );
  return { get, set, search: location.search, params };
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* التخزين ممنوع: بنكمّل من غير حفظ */
  }
}
