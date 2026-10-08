/** @format */
/**
 * Portal settings REGISTRY + layered resolver.
 *
 * Resolution order for a key: member → company → global → default (in code).
 * Nothing business-related should be hard-coded elsewhere: add a key here,
 * give it a schema + default + Arabic label, and read it via resolveSetting().
 */
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { portalSettingsTable } from "../db/schema";

export type SettingScope = "global" | "company" | "member";
export type SettingEditor = "staff" | "owner";

export type SettingDef<T = unknown> = {
  key: string;
  label: string; // simple Arabic
  description: string;
  group: string;
  schema: z.ZodType<T>;
  default: T;
  scopes: readonly SettingScope[]; // layers where it may be stored
  editableBy: readonly SettingEditor[]; // who may change it
};

const joinMode = z.enum(["approval", "auto", "disabled"]);
const chatMode = z.enum(["shared", "per_member", "per_member_monitored"]);
const cartScope = z.enum(["member", "company"]);
const whatsappNumbers = z
  .array(
    z.object({
      label: z.string().trim().min(1).max(60),
      phone: z.string().trim().min(8).max(20),
      enabled: z.boolean(),
      isDefault: z.boolean(),
    }),
  )
  .max(20);

function def<T>(d: SettingDef<T>): SettingDef<T> {
  return d;
}

export const PORTAL_SETTING_DEFS: readonly SettingDef<any>[] = [
  def({ key: "portal.multiuser.enabled", label: "تعدد الموظفين", description: "لو اتقفل، كل شركة بتشتغل بحساب واحد (الرئيس بس).", group: "team", schema: z.boolean(), default: true, scopes: ["global"], editableBy: ["staff"] }),
  def({ key: "team.max_members", label: "أقصى عدد موظفين", description: "أكبر عدد أعضاء نشطين في الشركة (بما فيهم الرئيس).", group: "team", schema: z.number().int().min(1).max(1000), default: 10, scopes: ["global", "company"], editableBy: ["staff"] }),
  def({ key: "join.mode", label: "طريقة الانضمام بالكود", description: "مباشر، أو بموافقة الرئيس، أو مقفول.", group: "join", schema: joinMode, default: "approval" as const, scopes: ["global", "company"], editableBy: ["staff", "owner"] }),
  def({ key: "join.code.enabled", label: "كود الانضمام شغال", description: "يقفل أو يفتح الانضمام بالكود.", group: "join", schema: z.boolean(), default: true, scopes: ["global", "company"], editableBy: ["staff", "owner"] }),
  def({ key: "join.code.expires_at", label: "ينتهي الكود في", description: "تاريخ انتهاء الكود (اختياري).", group: "join", schema: z.string().datetime().nullable(), default: null, scopes: ["company"], editableBy: ["staff", "owner"] }),
  def({ key: "join.code.max_uses", label: "أقصى استخدامات للكود", description: "عدد مرات استخدام الكود (اختياري).", group: "join", schema: z.number().int().min(1).max(10000).nullable(), default: null, scopes: ["company"], editableBy: ["staff", "owner"] }),
  def({ key: "join.default_role", label: "دور الموظف الجديد", description: "الدور اللي بياخده اللي ينضم بالكود.", group: "join", schema: z.string().trim().min(1).max(60), default: "buyer", scopes: ["global", "company"], editableBy: ["staff", "owner"] }),
  def({ key: "orders.min_qty", label: "أقل كمية للطلب", description: "الحد الأدنى للكمية في السطر.", group: "orders", schema: z.number().int().min(1), default: 1, scopes: ["global", "company"], editableBy: ["staff"] }),
  def({ key: "orders.cancel.company_max_status", label: "آخر مرحلة يلغي فيها الرئيس", description: "فاضي = في أي مرحلة.", group: "orders", schema: z.string().trim().min(1).max(60).nullable(), default: null, scopes: ["global", "company"], editableBy: ["staff"] }),
  def({ key: "cart.scope", label: "السلة", description: "لكل موظف أو مشتركة للشركة.", group: "orders", schema: cartScope, default: "member" as const, scopes: ["global", "company"], editableBy: ["staff", "owner"] }),
  def({ key: "chat.mode", label: "المحادثة", description: "مشتركة، أو لكل موظف، أو لكل موظف مع مراقبة الرئيس.", group: "chat", schema: chatMode, default: "shared" as const, scopes: ["global", "company"], editableBy: ["staff", "owner"] }),
  def({ key: "security.lockout.attempts", label: "محاولات الدخول قبل القفل", description: "عدد المحاولات الغلط قبل القفل المؤقت.", group: "security", schema: z.number().int().min(3).max(50), default: 5, scopes: ["global"], editableBy: ["staff"] }),
  def({ key: "security.lockout.minutes", label: "مدة القفل بالدقايق", description: "المدة اللي الحساب بيتقفل فيها بعد المحاولات الغلط.", group: "security", schema: z.number().int().min(1).max(1440), default: 15, scopes: ["global"], editableBy: ["staff"] }),
  def({ key: "security.require_recovery_method", label: "طريقة استعادة إجبارية", description: "يلزم العميل يسجّل طريقة استعادة.", group: "security", schema: z.boolean(), default: false, scopes: ["global", "company"], editableBy: ["staff"] }),
  def({ key: "contact.whatsapp_numbers", label: "أرقام واتساب الشركة", description: "الأرقام اللي بتتبعت منها رسائل التفعيل والدعم.", group: "contact", schema: whatsappNumbers, default: [{ label: "الدعم", phone: "01055651409", enabled: true, isDefault: true }], scopes: ["global"], editableBy: ["staff"] }),
  def({ key: "ui.theme.accent", label: "لون الواجهة", description: "اللون الأساسي للبوابة.", group: "ui", schema: z.string().trim().min(1).max(30), default: "blue", scopes: ["global", "company", "member"], editableBy: ["staff", "owner"] }),
  def({ key: "copy.overrides", label: "تعديل النصوص", description: "نصوص بديلة للواجهة (مفتاح ← نص).", group: "ui", schema: z.record(z.string().max(120), z.string().max(500)), default: {}, scopes: ["global", "company"], editableBy: ["staff"] }),
];

const DEF_BY_KEY = new Map(PORTAL_SETTING_DEFS.map((d) => [d.key, d]));

/** `ui.v2.<page>` flags are open-ended (one per migrated page). */
const UI_V2_PATTERN = /^ui\.v2\.[a-z0-9][a-z0-9-]{0,40}$/;
const UI_V2_DEF: SettingDef<boolean> = {
  key: "ui.v2.*",
  label: "الواجهة الجديدة للصفحة",
  description: "يشغّل الواجهة الجديدة للصفحة بدل القديمة.",
  group: "ui",
  schema: z.boolean(),
  default: false,
  scopes: ["global"],
  editableBy: ["staff"],
};

export function getSettingDef(key: string): SettingDef<any> | undefined {
  if (UI_V2_PATTERN.test(key)) return { ...UI_V2_DEF, key };
  return DEF_BY_KEY.get(key);
}

export type SettingContext = { companyId?: number | null; memberId?: number | null };

type Row = { scope: string; scopeId: number | null; key: string; value: unknown };

/**
 * Pure layering: member → company → global → default. Invalid stored values
 * are ignored (fall through) so a bad row can never break the portal.
 */
export function layerSetting(
  key: string,
  rows: readonly Row[],
  ctx: SettingContext,
): unknown {
  const d = getSettingDef(key);
  if (!d) throw new Error(`Unknown portal setting: ${key}`);
  const tryRow = (scope: SettingScope, scopeId: number | null) => {
    const row = rows.find(
      (r) => r.key === key && r.scope === scope && (r.scopeId ?? null) === scopeId,
    );
    if (!row) return { found: false as const };
    const parsed = d.schema.safeParse(row.value);
    return parsed.success ? { found: true as const, value: parsed.data } : { found: false as const };
  };
  const order: Array<[SettingScope, number | null]> = [];
  if (ctx.memberId) order.push(["member", ctx.memberId]);
  if (ctx.companyId) order.push(["company", ctx.companyId]);
  order.push(["global", null]);
  for (const [scope, id] of order) {
    if (!d.scopes.includes(scope)) continue;
    const hit = tryRow(scope, id);
    if (hit.found) return hit.value;
  }
  return d.default;
}

type Executor = Pick<typeof db, "select">;

/** Per-request resolver: loads all relevant rows once, then answers from memory. */
export async function createSettingsResolver(ctx: SettingContext, executor: Executor = db) {
  const conds = [and(eq(portalSettingsTable.scope, "global"), sql`${portalSettingsTable.scopeId} IS NULL`)];
  if (ctx.companyId) conds.push(and(eq(portalSettingsTable.scope, "company"), eq(portalSettingsTable.scopeId, ctx.companyId)));
  if (ctx.memberId) conds.push(and(eq(portalSettingsTable.scope, "member"), eq(portalSettingsTable.scopeId, ctx.memberId)));
  const rows = (await executor
    .select({
      scope: portalSettingsTable.scope,
      scopeId: portalSettingsTable.scopeId,
      key: portalSettingsTable.key,
      value: portalSettingsTable.value,
    })
    .from(portalSettingsTable)
    .where(or(...conds))) as Row[];
  return {
    get<T = unknown>(key: string): T {
      return layerSetting(key, rows, ctx) as T;
    },
  };
}

export async function resolveSetting<T = unknown>(
  key: string,
  ctx: SettingContext,
  executor: Executor = db,
): Promise<T> {
  const resolver = await createSettingsResolver(ctx, executor);
  return resolver.get<T>(key);
}

export class SettingValidationError extends Error {
  status = 400;
  code = "INVALID_SETTING";
}

/** Validates a write against the registry (key, scope, value). Returns the parsed value. */
export function validateSettingWrite(
  key: string,
  scope: SettingScope,
  value: unknown,
  editor: SettingEditor,
): unknown {
  const d = getSettingDef(key);
  if (!d) throw new SettingValidationError("الإعداد ده مش موجود");
  if (!d.scopes.includes(scope)) throw new SettingValidationError("الإعداد ده مينفعش يتحدد على المستوى ده");
  if (!d.editableBy.includes(editor)) throw new SettingValidationError("مش مسموحلك تغيّر الإعداد ده");
  const parsed = d.schema.safeParse(value);
  if (!parsed.success) throw new SettingValidationError("القيمة مش مناسبة للإعداد ده");
  return parsed.data;
}

export async function writeSetting(
  executor: Pick<typeof db, "execute">,
  input: { key: string; scope: SettingScope; scopeId: number | null; value: unknown; updatedBy: string },
): Promise<void> {
  await executor.execute(sql`
    INSERT INTO portal_settings (scope, scope_id, key, value, updated_by, updated_at)
    VALUES (${input.scope}, ${input.scopeId}, ${input.key}, ${JSON.stringify(input.value)}::jsonb, ${input.updatedBy}, now())
    ON CONFLICT (scope, (COALESCE(scope_id, 0)), key)
    DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `);
}

export async function clearSetting(
  executor: Pick<typeof db, "delete">,
  input: { key: string; scope: SettingScope; scopeId: number | null },
): Promise<void> {
  await executor
    .delete(portalSettingsTable)
    .where(
      and(
        eq(portalSettingsTable.scope, input.scope),
        eq(portalSettingsTable.key, input.key),
        input.scopeId === null
          ? sql`${portalSettingsTable.scopeId} IS NULL`
          : eq(portalSettingsTable.scopeId, input.scopeId),
      ),
    );
}

/** Catalogue for the settings screens (labels, defaults, who can edit). */
export function describeSettings() {
  return PORTAL_SETTING_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    group: d.group,
    default: d.default,
    scopes: d.scopes,
    editableBy: d.editableBy,
  }));
}

