/** هل العضو شاف دليل البوابة (أو قال «مش دلوقتي»)؟ بنحفظها في المتصفح بس، ولو التخزين مش شغّال الكارت بيظهر عادي. */
const key = (memberId: number | string | undefined) => `hyper_portal_guide_seen_${memberId ?? "anon"}`;

export function guideSeen(memberId: number | string | undefined): boolean {
  try {
    return localStorage.getItem(key(memberId)) === "1";
  } catch {
    return false;
  }
}

export function markGuideSeen(memberId: number | string | undefined): void {
  try {
    localStorage.setItem(key(memberId), "1");
  } catch {
    /* التخزين مش متاح: مفيش مشكلة */
  }
}
