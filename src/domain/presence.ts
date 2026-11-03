/** @format */
// «النشطين الآن» (الخطوة 38ب): مين عنده جلسة شغالة آخر 5 دقايق. بدون صفحة ولا IP ولا جهاز: اسم ودور وكام دقيقة بس.

export const ONLINE_WINDOW_MS = 5 * 60_000;

export const onlineCutoff = (now: Date = new Date()): Date => new Date(now.getTime() - ONLINE_WINDOW_MS);

/** كام دقيقة من آخر نشاط (لتحت، من غير ثواني). ساعة جهاز سابقة لساعتنا = 0. */
export function minutesAgo(last: Date | string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(last).getTime()) / 60_000));
}

export interface SessionPulse { userId: number; lastActiveAt: Date | string }

/** جلسات كتير لنفس الشخص (موبايل + كمبيوتر) بتتحسب مرة واحدة بأحدث نشاط. بيتجاهل خارج النافذة. الأحدث أولاً. */
export function collapseOnline(rows: readonly SessionPulse[], now: Date = new Date()): Array<{ userId: number; minutesAgo: number }> {
  const cutoff = onlineCutoff(now).getTime();
  const latest = new Map<number, number>();
  for (const r of rows) {
    const at = new Date(r.lastActiveAt).getTime();
    if (at < cutoff) continue;
    if (at > (latest.get(r.userId) ?? -Infinity)) latest.set(r.userId, at);
  }
  return [...latest.entries()].map(([userId, at]) => ({ userId, minutesAgo: minutesAgo(new Date(at), now) })).sort((a, b) => a.minutesAgo - b.minutesAgo || a.userId - b.userId);
}
