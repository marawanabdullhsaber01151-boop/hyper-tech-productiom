export const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(" ");

let n = 0;
/** id ثابت للـ aria (SSR مش مطلوب). */
export const uid = (p = "ht") => `${p}-${++n}`;
