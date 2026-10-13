/** @format */
/** Plan 08 — منطق نقي (من غير قاعدة بيانات) لاختيار المحادثة. */
export type ChatScope = {
  mode: "shared" | "per_member" | "per_member_monitored";
  /** null = محادثة الشركة المشتركة */
  memberId: number | null;
  canMonitor: boolean;
};

export function scopeFrom(
  mode: ChatScope["mode"],
  memberId: number | null | undefined,
  canViewCompany: boolean,
): ChatScope {
  // جلسة من غير هوية موظف (قديمة) بترجع للمحادثة المشتركة.
  const perMember = mode !== "shared" && !!memberId;
  return {
    mode,
    memberId: perMember ? memberId! : null,
    canMonitor: mode === "per_member_monitored" && canViewCompany,
  };
}

