const KEY = "hyper_staff_prefs";

export interface StaffPrefs {
  collapsed: boolean;
  openDept: string | null;
}

const DEFAULTS: StaffPrefs = { collapsed: false, openDept: null };

/** تفضيلات السايدبار: التخزين ممكن يكون ممنوع، فكل حاجة بـtry/catch. */
export function loadPrefs(): StaffPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const v = JSON.parse(raw) as Partial<StaffPrefs>;
    return {
      collapsed: v.collapsed === true,
      openDept: typeof v.openDept === "string" ? v.openDept : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: StaffPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ممنوع — عادي */
  }
}
