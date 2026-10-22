import { api } from "../admin/api";
import { staffUser } from "../admin/session";

/**
 * كاش صغير لقراءات الـGET اللي أكتر من حتة في الرئيسية والجرس ولوحة الأوامر محتاجينها (أوامر الإنتاج، المخزون…).
 * بيدمج الطلبات المتزامنة وبيحتفظ بالنتيجة مدة قصيرة، فمفيش نفس الطلب يتكرر كذا مرة في الدقيقة.
 * الكاش لكل مستخدم (مفتاحه فيه رقم المستخدم) وبيتمسح عند الخروج، عشان بيانات موظف ما توصلش لموظف تاني في نفس المتصفح.
 */
const cache = new Map<string, { at: number; promise: Promise<unknown> }>();
const key = (path: string) => `${staffUser()?.id ?? 0}:${path}`;

export function getShared<T>(path: string, ttlMs = 30_000): Promise<T> {
  const k = key(path);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise as Promise<T>;
  const promise = api.get<T>(path);
  cache.set(k, { at: Date.now(), promise });
  // الفشل ما يتخزّنش: المحاولة الجاية تجرّب تاني
  promise.catch(() => {
    if (cache.get(k)?.promise === promise) cache.delete(k);
  });
  return promise;
}

/** بدون مسار: بيمسح كل حاجة (الخروج). */
export function invalidateShared(path?: string): void {
  if (path === undefined) cache.clear();
  else cache.delete(key(path));
}
