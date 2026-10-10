/** @format */
import { resolveSetting } from "../portalSettings";

export type TemplateKey =
  | "activation"
  | "recovery_link"
  | "channel_verify"
  | "password_changed"
  | "recovery_code_used"
  | "owner_reset_link";

const DEFAULTS: Record<TemplateKey, { subject: string; body: string }> = {
  activation: {
    subject: "فعّل حسابك في Hyper-Tech",
    body: "أهلاً {name}، حسابك في Hyper-Tech جاهز.\nافتح الرابط واختار كلمة السر (صالح {duration}): {url}",
  },
  recovery_link: {
    subject: "استعادة كلمة السر",
    body: "طلبت استعادة كلمة السر لحسابك في Hyper-Tech.\nالرابط صالح {duration}: {url}\nلو مش إنت اللي طلبت، تجاهل الرسالة.",
  },
  channel_verify: {
    subject: "كود تأكيد الإيميل",
    body: "كود التأكيد بتاعك في Hyper-Tech: {code}\nصالح {duration}.",
  },
  password_changed: {
    subject: "اتغيّرت كلمة السر",
    body: "كلمة سر حسابك في Hyper-Tech اتغيّرت دلوقتي.\nلو مش إنت، كلّم الدعم فورًا.",
  },
  recovery_code_used: {
    subject: "اتستخدم كود استعادة",
    body: "اتستخدم كود استعادة على حسابك في Hyper-Tech.\nلو مش إنت، كلّم الدعم فورًا.",
  },
  owner_reset_link: {
    subject: "رابط تعيين كلمة سر جديدة",
    body: "{owner} بعتلك رابط لتعيين كلمة سر جديدة (صالح {duration}): {url}",
  },
};

export function humanDuration(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) return minutes === 1440 ? "24 ساعة" : `${minutes / 1440} أيام`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} ساعة`;
  return `${minutes} دقيقة`;
}

export function fillTemplate(text: string, vars: Record<string, string | number | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
}

/** Staff can override wording through the `copy.overrides` setting (msg.<key>.body / .subject). */
export async function renderTemplate(
  key: TemplateKey,
  vars: Record<string, string | number | undefined>,
): Promise<{ subject: string; text: string }> {
  let overrides: Record<string, string> = {};
  try {
    overrides = await resolveSetting<Record<string, string>>("copy.overrides", {});
  } catch {
    /* defaults */
  }
  const d = DEFAULTS[key];
  return {
    subject: fillTemplate(overrides[`msg.${key}.subject`] ?? d.subject, vars),
    text: fillTemplate(overrides[`msg.${key}.body`] ?? d.body, vars),
  };
}
