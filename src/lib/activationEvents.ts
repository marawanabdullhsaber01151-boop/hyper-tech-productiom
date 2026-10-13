/** @format */
import { db } from "../db";
import { portalActivationRequestEventsTable } from "../db/schema";

type Exec = Pick<typeof db, "insert">;

export async function addActivationEvent(
  tx: Exec,
  requestId: number,
  e: { kind: string; actorUserId?: number | null; actorLabel?: string | null; note?: string | null; data?: unknown },
) {
  await tx.insert(portalActivationRequestEventsTable).values({
    requestId,
    kind: e.kind,
    actorUserId: e.actorUserId ?? null,
    actorLabel: e.actorLabel ?? "system",
    note: e.note ?? null,
    data: (e.data ?? null) as never,
  });
}
