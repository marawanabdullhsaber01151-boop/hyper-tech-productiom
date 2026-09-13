/** @format */

import { and, eq } from "drizzle-orm";
import {
  foundationTransitionsTable,
  phase0NumberSequencesTable,
} from "../db/schema";

type TransactionLike = {
  select: (...args: any[]) => any;
  update: (...args: any[]) => any;
};

export function phase0Error(message: string, status = 422) {
  return Object.assign(new Error(message), { status });
}

/**
 * Generates a unique human-readable number while holding the sequence row lock.
 * It must be called from the transaction that inserts the record using the number.
 */
export async function nextPhase0Number(
  tx: TransactionLike,
  sequenceKey: string,
) {
  const [sequence] = await tx
    .select()
    .from(phase0NumberSequencesTable)
    .where(
      and(
        eq(phase0NumberSequencesTable.sequenceKey, sequenceKey),
        eq(phase0NumberSequencesTable.active, true),
      ),
    )
    .for("update");

  if (!sequence) {
    throw phase0Error(`ترقيم المرحلة 00 غير مُعرّف: ${sequenceKey}`, 500);
  }

  const value = Number(sequence.nextValue);
  await tx
    .update(phase0NumberSequencesTable)
    .set({ nextValue: value + 1, updatedAt: new Date() })
    .where(eq(phase0NumberSequencesTable.id, sequence.id));

  return `${sequence.prefix}${String(value).padStart(sequence.padding, "0")}`;
}

/**
 * Central transition guard for phase-0 state machines.
 * A transition is valid only when it is explicitly configured for the caller's role.
 */
export async function assertPhase0Transition(
  tx: TransactionLike,
  input: {
    entityType: string;
    fromState: string;
    toState: string;
    role: string;
    reason?: string | null;
  },
) {
  if (input.fromState === input.toState) {
    throw phase0Error("لا يمكن تنفيذ انتقال إلى نفس الحالة");
  }

  const [transition] = await tx
    .select()
    .from(foundationTransitionsTable)
    .where(
      and(
        eq(foundationTransitionsTable.entityType, input.entityType),
        eq(foundationTransitionsTable.fromState, input.fromState),
        eq(foundationTransitionsTable.toState, input.toState),
        eq(foundationTransitionsTable.requiredRole, input.role),
        eq(foundationTransitionsTable.active, true),
      ),
    )
    .limit(1);

  if (!transition) {
    throw phase0Error("انتقال الحالة غير مسموح لهذا الدور", 403);
  }
  if (transition.requiresReason && !input.reason?.trim()) {
    throw phase0Error("هذا الانتقال يحتاج سببًا موثقًا");
  }
  return transition;
}

export function assertReferencedMovement(input: {
  referenceType?: string | null;
  referenceId?: number | null;
}) {
  if (!input.referenceType || !input.referenceId) {
    throw phase0Error("كل حركة مخزون يجب أن ترتبط بمصدر ورقم مرجعي");
  }
}