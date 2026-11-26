/** نصوص عناصر الطي (فتح/قفل) في تبويبات الدليل الطويلة. */
import { registerCopy } from "./registry";

export const guide7Copy = {
  "guide.fold.hint": "اضغط على أي عنوان عشان تفتح تفاصيله، واضغط تاني عشان تقفله. كل الكلام موجود، بس مطوي لحد ما تحتاجه.",
  "guide.fold.openAll": "افتح الكل",
  "guide.fold.closeAll": "اقفل الكل",
  "guide.fold.jump": "روح لـ",
  "guide.fold.fields": "{n} خانة",
  "guide.fold.steps": "{n} خطوة",
} as const;

registerCopy(guide7Copy);
