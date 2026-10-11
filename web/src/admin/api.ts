import { createApiClient } from "../api/client";
import { staffSession } from "../auth/staffSession";
import { goStaffLogin } from "./session";

/** عميل الـ API للموظفين. لو الجلسة خلصت بنرجّعه لصفحة الدخول. */
export const api = createApiClient({ session: staffSession, onUnauthorized: goStaffLogin });

/** بينزّل ملف CSV بتوكن الموظف (الرابط العادي مش هيبعت التوكن). */
export async function downloadCsv(path: string, query: Record<string, string | number | undefined>, filename: string): Promise<boolean> {
  try {
    const url = new URL(`/api/v1${path}`, location.origin);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const token = staffSession.get()?.token;
    const res = await fetch(url.pathname + url.search, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return false;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  } catch {
    return false;
  }
}
