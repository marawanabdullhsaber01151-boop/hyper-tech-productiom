/** بحث عربي متسامح: الهمزات والتشكيل والتاء المربوطة والأرقام الهندية ما بتفرقش. خالص (من غير واجهة). */

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(TASHKEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/[\s\-_/\\.]+/g, " ")
    .trim();
}

function subsequence(q: string, text: string): boolean {
  let i = 0;
  for (const ch of text) if (ch === q[i] && ++i === q.length) return true;
  return q.length === 0;
}

/**
 * درجة تطابق نص مع استعلام (0 = مفيش تطابق). كل كلمة في الاستعلام لازم تتطابق (AND).
 * 100 مطابق تمامًا، 80 بداية النص، 60 بداية كلمة، 40 جزء من كلمة، 15 حروف بالترتيب (للاستعلامات 3+ حروف).
 */
export function scoreMatch(query: string, text: string): number {
  const q = normalize(query);
  const x = normalize(text);
  if (!q) return 1;
  if (!x) return 0;
  if (x === q) return 100;
  const tokens = q.split(" ");
  const words = x.split(" ");
  let total = 0;
  for (const tok of tokens) {
    let best = 0;
    if (x.startsWith(tok)) best = 80;
    else if (words.some((w) => w.startsWith(tok))) best = 60;
    else if (x.includes(tok)) best = 40;
    else if (tok.length >= 3 && subsequence(tok, x.replace(/ /g, ""))) best = 15;
    if (best === 0) return 0;
    total += best;
  }
  return Math.round(total / tokens.length);
}

/** أعلى درجة بين عدة نصوص للعنصر الواحد (العنوان أهم من الكلمات المفتاحية). */
export function bestScore(query: string, texts: Array<{ text: string; weight?: number }>): number {
  let best = 0;
  for (const { text, weight = 1 } of texts) best = Math.max(best, scoreMatch(query, text) * weight);
  return best;
}
