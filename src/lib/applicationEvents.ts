/** @format */
import { db } from "../db";
import { portalApplicationEventsTable } from "../db/schema";
import { statusForStage } from "./applicationMatching";

type Exec = Pick<typeof db, "insert">;

export async function addApplicationEvent(
  tx: Exec,
  applicationId: number,
  e: {
    kind: string;
    stageFrom?: string | null;
    stageTo?: string | null;
    actorUserId?: number | null;
    actorLabel?: string | null;
    note?: string | null;
    data?: unknown;
  },
) {
  await tx.insert(portalApplicationEventsTable).values({
    applicationId,
    kind: e.kind,
    stageFrom: e.stageFrom ?? null,
    stageTo: e.stageTo ?? null,
    actorUserId: e.actorUserId ?? null,
    actorLabel: e.actorLabel ?? "system",
    note: e.note ?? null,
    data: (e.data ?? null) as never,
  });
}

/** Columns to set so `stage` and the legacy `status` never drift apart. */
export function stagePatch(stage: string) {
  return { stage, status: statusForStage(stage), updatedAt: new Date() };
}
