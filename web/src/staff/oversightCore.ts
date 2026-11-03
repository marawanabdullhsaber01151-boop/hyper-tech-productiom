/** منطق متابعة الإنتاج النقي (الخطوة 37أ). السيرفر هو الحَكَم (src/lib/productionOversight.ts). */
export const NOTE_WRITE_ROLES = ["chairman", "production_manager", "supervisor", "production_quality_controller", "warehouse_manager", "operations_manager"] as const;
export const NOTE_READ_ROLES = [...NOTE_WRITE_ROLES, "executive_manager"] as const;
export const canReadNotes = (role: string | undefined) => !!role && (NOTE_READ_ROLES as readonly string[]).includes(role);
export const canWriteNotes = (role: string | undefined) => !!role && (NOTE_WRITE_ROLES as readonly string[]).includes(role);

export const NOTE_KINDS = ["observation", "issue", "instruction", "handover"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const isNoteKind = (k: string): k is NoteKind => (NOTE_KINDS as readonly string[]).includes(k);
export const noteTone = (k: string): "neutral" | "danger" | "info" | "brand" => (k === "issue" ? "danger" : k === "instruction" ? "info" : k === "handover" ? "brand" : "neutral");

export interface OrderNote { id: number; kind: string; body: string; createdByName: string | null; createdAt: string }
export interface StalledRow { id: number; orderNumber: string; workflowStatus: string; idleHours: number; thresholdHours: number; ratio: number }

export const noteError = (body: string) => (body.trim().length < 3 ? "body" : null);
export const notePayload = (kind: string, body: string) => ({ kind: isNoteKind(kind) ? kind : "observation", body: body.trim() });

/** خريطة الأوامر الواقفة بالـid للبحث السريع في الجدول. */
export const stalledMap = (rows: readonly StalledRow[] | undefined): Map<number, StalledRow> => new Map((rows ?? []).map((r) => [r.id, r]));
export const hoursLabel = (h: number) => String(Math.floor(h));
