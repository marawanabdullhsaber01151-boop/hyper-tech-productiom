/** @format */
// متابعة الأوامر الواقفة (الخطوة 37أ): بتجيب آخر نشاط لكل أمر مفتوح، وتحسب السكون، وتفتح مهمة بشرية بتصعيد لكل أمر واقف.
import { sql } from "drizzle-orm";
import { db } from "../db";
import { loadOperationalConfig } from "./settingsStore";
import { createTask } from "./humanTasks";
import { STALL_OWNER, STALL_STATUSES, stallDedupeKey, stallInfo, stallPriority, type StallInfo } from "../domain/production-stall";

/** مين يكتب ويقرا ملاحظات المشرف. */
export const NOTE_WRITE_ROLES = ["chairman", "production_manager", "supervisor", "production_quality_controller", "warehouse_manager", "operations_manager"] as const;
export const NOTE_READ_ROLES = [...NOTE_WRITE_ROLES, "executive_manager"] as const;
export const canWriteNotes = (role: string) => (NOTE_WRITE_ROLES as readonly string[]).includes(role);

export interface StalledOrder extends StallInfo {
  id: number;
  orderNumber: string;
  productName: string;
  workflowStatus: string;
  lastActivityAt: string;
}

/** كل الأوامر المفتوحة مع آخر نشاط (الأمر نفسه، ملاحظة، تأكيد عملية، توقف) وحالة السكون. */
export async function listOrderActivity(now = new Date(), executor: Pick<typeof db, "execute"> = db): Promise<Array<StalledOrder & { stalled: boolean }>> {
  const factor = (await loadOperationalConfig()).stallFactor;
  const statuses = sql.join(STALL_STATUSES.map((s) => sql`${s}`), sql`, `);
  const res = await executor.execute(sql`
    SELECT o.id, o.order_number, o.product_name, o.workflow_status,
      GREATEST(
        o.updated_at,
        COALESCE((SELECT max(n.created_at) FROM production_order_notes n WHERE n.workflow_order_id = o.id), o.updated_at),
        COALESCE((SELECT max(c.created_at) FROM production_operation_confirmations c WHERE c.workflow_order_id = o.id), o.updated_at),
        COALESCE((SELECT max(d.created_at) FROM production_downtimes d WHERE d.workflow_order_id = o.id), o.updated_at)
      ) AS last_activity
    FROM production_workflow_orders o
    WHERE o.workflow_status IN (${statuses})
    ORDER BY o.id`);
  return (res.rows as Array<Record<string, unknown>>).map((r) => {
    const last = new Date(r.last_activity as string);
    return { id: Number(r.id), orderNumber: String(r.order_number), productName: String(r.product_name), workflowStatus: String(r.workflow_status), lastActivityAt: last.toISOString(), ...stallInfo(String(r.workflow_status), last, now, factor) };
  });
}

export async function listStalledOrders(now = new Date()): Promise<StalledOrder[]> {
  return (await listOrderActivity(now)).filter((o) => o.stalled).sort((a, b) => b.ratio - a.ratio);
}

/** بيفتح مهمة لكل أمر واقف (من غير تكرار). بيتنادى من عامل الـ15 دقيقة، وفشله مايوقفش الباقي. */
export async function scanStalledOrders(opts: { now?: Date; limit?: number } = {}): Promise<{ stalled: number; created: number }> {
  const now = opts.now ?? new Date();
  const stalled = (await listStalledOrders(now)).slice(0, opts.limit ?? 50);
  let created = 0;
  for (const o of stalled) {
    const owner = STALL_OWNER[o.workflowStatus];
    if (!owner) continue;
    const { duplicate } = await createTask(
      {
        kind: "stalled_stage",
        title: `أمر الإنتاج ${o.orderNumber} واقف`,
        description: `أمر «${o.productName}» ما حصلش عليه أي نشاط من ${Math.floor(o.idleHours)} ساعة (الحد ${o.thresholdHours} ساعة لمرحلته). حرّكه أو اكتب ملاحظة بسبب الوقوف.`,
        priority: stallPriority(o),
        assigneeRole: owner.role,
        escalateToRole: owner.escalateTo,
        dueAt: new Date(now.getTime() + 12 * 3_600_000),
        sourceType: "production_workflow_order",
        sourceId: o.id,
        dedupeKey: stallDedupeKey(o.id, o.workflowStatus, new Date(o.lastActivityAt)),
      },
      null,
    ).catch(() => ({ duplicate: true }));
    if (!duplicate) created += 1;
  }
  return { stalled: stalled.length, created };
}
