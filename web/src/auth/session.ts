/** جلسة محفوظة بنفس شكل الصفحات القديمة عشان الدخول يفضل مشترك بينهم. */
export interface StoredSession {
  token: string;
  rememberMe?: boolean;
  [k: string]: unknown;
}

export interface SessionStore {
  key: string;
  get(): StoredSession | null;
  save(s: StoredSession): void;
  clear(): void;
  onExpire(cb: () => void): () => void;
}

type Area = "local" | "session";
const area = (a: Area): Storage | null => {
  try {
    return a === "local" ? localStorage : sessionStorage;
  } catch {
    return null;
  }
};

export function createSessionStore(key: string, opts: { allowLocal: boolean }): SessionStore {
  const listeners = new Set<() => void>();
  const read = (a: Area): StoredSession | null => {
    const st = area(a);
    if (!st) return null;
    try {
      const raw = st.getItem(key);
      if (!raw) return null;
      const v = JSON.parse(raw) as StoredSession;
      return v && typeof v.token === "string" ? v : null;
    } catch {
      try {
        st.removeItem(key);
      } catch {
        /* ignore */
      }
      return null;
    }
  };
  return {
    key,
    get: () => (opts.allowLocal ? read("local") : null) ?? read("session"),
    save(s) {
      const target: Area = opts.allowLocal && s.rememberMe === true ? "local" : "session";
      const other: Area = target === "local" ? "session" : "local";
      try {
        area(target)?.setItem(key, JSON.stringify(s));
        area(other)?.removeItem(key);
      } catch {
        /* التخزين ممنوع: الجلسة هتعيش في الذاكرة بس */
      }
    },
    clear() {
      for (const a of ["local", "session"] as Area[]) {
        try {
          area(a)?.removeItem(key);
        } catch {
          /* ignore */
        }
      }
    },
    onExpire(cb) {
      listeners.add(cb);
      const handler = (e: StorageEvent) => {
        if (e.key === key && !e.newValue && e.oldValue) cb();
      };
      window.addEventListener("storage", handler);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", handler);
      };
    },
  };
}
