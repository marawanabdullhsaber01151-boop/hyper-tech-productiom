import type { Msg } from "./ar";

/**
 * نصوص الصفحات الكبيرة (مبيعات، مشتريات، جهات اتصال، تشغيل، إنتاج، هندسة، مخزون) مش جوّه الحزمة الرئيسية.
 * كل ملف نصوص بيسجّل نفسه هنا أول ما يتحمّل، وكل ملف بيستخدم مفاتيحه بيعمل له import صريح
 * (`import "../copy/sales"`) فالنص بيوصل مع الصفحة نفسها. فحص copy بيتأكد من ده (check-copy.ts).
 */
const lazy: Record<string, Msg> = {};

export function registerCopy(dict: Record<string, Msg>): void {
  Object.assign(lazy, dict);
}

export function lookupLazy(key: string): Msg | undefined {
  return lazy[key];
}
