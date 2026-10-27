/** قواعد صفحة الإنتاج (طلبات الإنتاج + الجودة + التتبع). بدون واجهة، عشان تتختبر لوحدها. السيرفر هو الحَكَم الفعلي. */

export const REQUEST_STATUSES = ["pending_warehouse", "pending_director", "approved", "partial_approved", "rejected", "cancelled"] as const;
export const REQUEST_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export const REQUEST_UNITS = ["kg", "g", "ton", "l", "ml", "piece", "m", "cm", "box", "pack", "roll", "set"] as const;
export const NCR_DISPOSITIONS = ["hold", "rework", "scrap", "sort", "use_as_is"] as const;

/** لازم تتطابق مع src/lib/productionQualityCore.ts ومع حراس routes/production-requests.ts في السيرفر. */
export const REQUEST_VIEW_ROLES = ["chairman", "supervisor", "production_manager", "warehouse_manager", "storekeeper"] as const;
export const REQUEST_CREATE_ROLES = ["chairman", "supervisor", "production_manager"] as const;
export const WAREHOUSE_DECIDE_ROLES = ["chairman", "warehouse_manager", "storekeeper"] as const;
export const DIRECTOR_DECIDE_ROLES = ["chairman", "production_manager"] as const;
export const REQUEST_CANCEL_ROLES = ["chairman", "production_manager", "supervisor"] as const;
/** نفس productionRoles في routes/production-execution.ts. */
export const QUALITY_VIEW_ROLES = ["chairman", "production_manager", "production_controller", "supervisor", "production_quality_controller"] as const;
export const NCR_CLOSE_ROLES = ["chairman", "production_manager", "production_quality_controller"] as const;

export const PRODUCTION_PAGE_ROLES = [...new Set<string>([...REQUEST_VIEW_ROLES, ...QUALITY_VIEW_ROLES])];

const has = (list: readonly string[], role: string) => list.includes(role);

export type ProductionTab = "requests" | "quality" | "trace";

/** التبويبات اللي الدور يشوفها: كل دور ما يشوفش غير اللي السيرفر هيسمحله بيه. */
export function availableTabs(role: string): ProductionTab[] {
  const out: ProductionTab[] = [];
  if (has(REQUEST_VIEW_ROLES, role)) out.push("requests");
  if (has(QUALITY_VIEW_ROLES, role)) out.push("quality", "trace");
  return out;
}

export type RequestAction = "warehouse_approve" | "warehouse_partial" | "warehouse_reject" | "director" | "cancel";

/** الإجراءات المتاحة على طلب حسب الدور والحالة (نفس منطق الصفحة القديمة + قرار الإدارة جوّه الصف). */
export function requestActions(role: string, status: string): RequestAction[] {
  const out: RequestAction[] = [];
  if (status === "pending_warehouse" && has(WAREHOUSE_DECIDE_ROLES, role)) out.push("warehouse_approve", "warehouse_partial", "warehouse_reject");
  if (status === "pending_director" && has(DIRECTOR_DECIDE_ROLES, role)) out.push("director");
  if ((status === "pending_director" || status === "pending_warehouse") && has(REQUEST_CANCEL_ROLES, role)) out.push("cancel");
  return out;
}

export const canCreateRequest = (role: string) => has(REQUEST_CREATE_ROLES, role);
export const canCloseNcr = (role: string) => has(NCR_CLOSE_ROLES, role);

export const QTY_RE = /^\d+(\.\d{1,4})?$/;
export const NCR_QTY_RE = /^\d+(\.\d{1,3})?$/;

export const isPositiveQty = (s: string, re: RegExp = QTY_RE) => re.test(s.trim()) && Number(s) > 0;

/** الكمية الجزئية لازم تكون أكبر من صفر وأقل من المطلوب أو تساويه. */
export function partialQtyError(qty: string, requested: string): "bad" | "tooMuch" | null {
  if (!isPositiveQty(qty)) return "bad";
  return Number(qty) > Number(requested) ? "tooMuch" : null;
}

export type DirectorAction = "approve" | "override" | "reject" | "noted";

/** قرار الإدارة: الاعتماد الاستثنائي لازم له كمية، والرفض لازم له سبب (عشان التتبع). */
export function directorError(action: DirectorAction, overrideQty: string, comment: string): "qty" | "comment" | null {
  if (action === "override" && !isPositiveQty(overrideQty)) return "qty";
  if (action === "reject" && comment.trim().length < 3) return "comment";
  return null;
}

/** أعداد الطلبات حسب الحالة، للبطاقات اللي فوق القايمة. */
export function countByStatus(rows: readonly { status: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

/** أوامر الإنتاج اللي ينفع تتفتح عليها حالة عدم مطابقة (اللي بدأ تصنيعها). */
export const NCR_ORDER_STATUSES = ["in_production", "quality_check", "completed"] as const;
export const ncrOrderOk = (workflowStatus: string) => (NCR_ORDER_STATUSES as readonly string[]).includes(workflowStatus);

/** أكواد العيوب المستخدمة قبل كده (للاقتراح بدل الكتابة من الصفر). مرتبة بالأكثر استخدامًا. */
export function defectSuggestions(rows: readonly { defectCode: string }[], limit = 8): string[] {
  const n = new Map<string, number>();
  for (const r of rows) {
    const c = r.defectCode.trim();
    if (c) n.set(c, (n.get(c) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([c]) => c);
}
