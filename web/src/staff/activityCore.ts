/** منطق سجل النشاط النقي (الخطوة 38أ). السيرفر هو الحَكَم (src/routes/activity.ts). */
export const ACTIVITY_ROLES = ["chairman", "executive_manager"] as const;
export const canSeeActivity = (role: string | undefined) => !!role && (ACTIVITY_ROLES as readonly string[]).includes(role);

export interface ActivityRow { id: number; sentence: string; whenText: string; createdAt: string; actorUserId: number | null; section: string; sectionLabel: string | null; rejected: boolean }
export interface ActivityPage { data: ActivityRow[]; nextBefore: number | null }
export interface ActivityMeta { sections: Array<{ id: string; label: string }>; actors: Array<{ id: number; name: string; roleLabel: string }> }
export interface ActivityFilters { actorId: string; section: string; from: string; to: string; includeViews: boolean }

export const EMPTY_FILTERS: ActivityFilters = { actorId: "", section: "", from: "", to: "", includeViews: false };

/** الفترة لازم تتحدد من وإلى مع بعض (أو تتساب فاضية)، و«من» قبل «إلى» أو يساويه. */
export const filtersError = (f: ActivityFilters): "range" | null => {
  const a = f.from.trim(), b = f.to.trim();
  if (!a && !b) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b) && a <= b ? null : "range";
};

/** سلسلة الاستعلام: بتسقط الفاضي، وبترمّز القيم. */
export function activityQuery(f: ActivityFilters, before: number | null = null): string {
  const p: string[] = [];
  if (before) p.push(`before=${before}`);
  if (/^\d+$/.test(f.actorId)) p.push(`actorId=${f.actorId}`);
  if (f.section) p.push(`section=${encodeURIComponent(f.section)}`);
  if (f.from && f.to) p.push(`from=${encodeURIComponent(f.from)}`, `to=${encodeURIComponent(f.to)}`);
  if (f.includeViews) p.push("includeViews=1");
  return p.length ? `?${p.join("&")}` : "";
}

export interface DayGroup { day: string; rows: Array<ActivityRow & { time: string }> }
/** تجميع بالأيام من نص الوقت الجاهز من السيرفر (توقيت القاهرة): «2026/10/12 08:13 ص». */
export function groupByDay(rows: readonly ActivityRow[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const r of rows) {
    const day = r.whenText.slice(0, 10);
    const time = r.whenText.slice(11);
    const last = out[out.length - 1];
    if (last && last.day === day) last.rows.push({ ...r, time });
    else out.push({ day, rows: [{ ...r, time }] });
  }
  return out;
}

/** دمج صفحة جديدة في القايمة من غير تكرار (لو الصفحتين اتداخلوا). */
export function mergeRows(prev: readonly ActivityRow[], next: readonly ActivityRow[]): ActivityRow[] {
  const seen = new Set(prev.map((r) => r.id));
  return [...prev, ...next.filter((r) => !seen.has(r.id))];
}

export interface OnlineUser { userId: number; name: string; roleLabel: string; minutesAgo: number }
/** صياغة «آخر نشاط»: أقل من دقيقة = «دلوقتي»، غير كده «منذ N دقيقة». */
export const onlineKind = (minutesAgo: number): "now" | "ago" => (minutesAgo < 1 ? "now" : "ago");
/** تحديث القايمة كل دقيقة (نفس دقة تحديث آخر نشاط للجلسة في السيرفر). */
export const ONLINE_REFRESH_MS = 60_000;
