import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true");
}

let locks = 0;
function lockScroll() {
  if (locks++ === 0) document.documentElement.style.overflow = "hidden";
}
function unlockScroll() {
  if (--locks <= 0) {
    locks = 0;
    document.documentElement.style.overflow = "";
  }
}

/**
 * مودال: بيحبس الـ Tab جوّه، Esc بيقفل، بيقفل السكرول، وبيرجّع التركيز للي فتحه.
 * initialFocus: selector جوّه الحاوية (الافتراضي أول عنصر قابل للتركيز).
 */
export function useModal(open: boolean, onClose: () => void, initialFocus?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement as HTMLElement | null;
    lockScroll();
    const target = (initialFocus ? root.querySelector<HTMLElement>(initialFocus) : null) ?? focusablesIn(root)[0] ?? root;
    target.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusablesIn(root);
      if (!items.length) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      unlockScroll();
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, initialFocus]);

  return ref;
}

/** يقفل لما تضغط برّه العنصر. */
export function useOutsideClick(ref: { current: HTMLElement | null }, active: boolean, cb: () => void) {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cbRef.current();
    };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("touchstart", h);
    };
  }, [active, ref]);
}
