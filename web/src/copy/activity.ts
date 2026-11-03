/** نصوص صفحة سجل النشاط (الخطوة 38أ). */
import { registerCopy } from "./registry";

export const activityCopy = {
  "act.title": "سجل النشاط",
  "act.subtitle": "مين عمل إيه وامتى في النظام، بجمل بسيطة. للإدارة العليا بس.",
  "act.actor": "الموظف",
  "act.actorAll": "كل الموظفين",
  "act.section": "القسم",
  "act.sectionAll": "كل الأقسام",
  "act.from": "من",
  "act.to": "إلى",
  "act.preset.today": "النهاردة",
  "act.preset.week": "آخر 7 أيام",
  "act.preset.all": "الكل",
  "act.views": "إظهار أحداث الفتح والعرض",
  "act.rangeBad": "الفترة غير صحيحة: لازم تحدد «من» و«إلى»، و«من» قبل «إلى» أو يساويه.",
  "act.loadFail": "تعذّر تحميل السجل.",
  "act.metaFail": "تعذّر تحميل قوايم الفلاتر.",
  "act.empty": "مفيش نشاط مطابق للفلاتر دي.",
  "act.more": "عرض المزيد",
  "act.rejected": "ماتنفّذش",
  "act.note": "الأحداث المتكررة (الطلب والحدث التفصيلي له) بتتعرض مرة واحدة. أحداث الفتح والعرض مخفية افتراضيًا.",
  "act.nav": "سجل النشاط",
} as const;

registerCopy(activityCopy);
