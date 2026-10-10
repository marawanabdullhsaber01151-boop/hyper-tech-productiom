import { useEffect, useState } from "preact/hooks";

/** مخزن صغير: قيمة + مشتركين. بيغني عن مكتبة state. */
export interface Store<T> {
  get(): T;
  set(next: Partial<T> | ((s: T) => T)): void;
  subscribe(cb: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      state = typeof next === "function" ? next(state) : { ...state, ...next };
      subs.forEach((cb) => cb());
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), [store]);
  return store.get();
}
