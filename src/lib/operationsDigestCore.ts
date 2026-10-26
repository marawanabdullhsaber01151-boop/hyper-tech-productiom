/** صياغة الملخص اليومي للتشغيل (نقي). لو مفيش حاجة محتاجة تدخل بيطمّن، وغير كده بيرتّب الأهم الأول. */
export interface OpsDigestInput {
  activeCases: number;
  atRiskCases: number;
  unassigned: number;
  awaitingClaim: number;
  requisitionsPending: number;
  transfersPending: number;
  overdueOrders: number;
  plansWaiting: number;
  utilization: number; // 0..2
  overloadedDays: number;
  lateOrders: number;
}
export interface OpsDigest {
  title: string;
  body: string;
  attention: number;
}

export const OPS_DIGEST_TYPE = "operations_daily_digest";
export const OPS_DIGEST_REF = "operations_center";
export const OPS_DIGEST_DEDUPE_HOURS = 20;

export function composeOpsDigest(i: OpsDigestInput): OpsDigest {
  const items: Array<[number, string]> = [
    [i.atRiskCases, `${i.atRiskCases} حالة معرّضة للتأخير`],
    [i.overdueOrders, `${i.overdueOrders} أمر إنتاج عدّى موعده`],
    [i.lateOrders, `${i.lateOrders} أمر متوقع يخلص بعد موعده بحسب السعة`],
    [i.overloadedDays, `${i.overloadedDays} يوم محمّل لحد السقف في الـ14 يوم الجايين`],
    [i.plansWaiting, `${i.plansWaiting} خطة مستنية اعتماد`],
    [i.unassigned, `${i.unassigned} حالة من غير مسؤول`],
    [i.awaitingClaim, `${i.awaitingClaim} أمر إنتاج مستني استلام`],
    [i.requisitionsPending, `${i.requisitionsPending} احتياج شراء مستني تأكيدك`],
    [i.transfersPending, `${i.transfersPending} تحويل خامات مستني استلام`],
  ];
  const shown = items.filter(([n]) => n > 0).map(([, text]) => `• ${text}`);
  const attention = items.filter(([n]) => n > 0).length;
  const pct = Math.round(i.utilization * 100);
  const head = `${i.activeCases} حالة نشطة، وتحميل المصنع ${pct}% من طاقة الـ14 يوم الجايين.`;
  return {
    attention,
    title: attention ? `ملخص التشغيل: ${attention} بند محتاج متابعة` : "ملخص التشغيل: كله ماشي تمام",
    body: [head, ...(shown.length ? shown : ["مفيش حاجة متأخرة أو مستنية قرار."])].join("\n"),
  };
}
