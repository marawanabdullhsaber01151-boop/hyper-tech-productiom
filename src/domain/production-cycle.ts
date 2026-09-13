/** @format */

export type ProductionCycleStage = {
  key: string;
  number: number;
  name: string;
  shortName: string;
  description: string;
  statuses: string[];
};

/**
 * The operational production cycle is deliberately kept separate from the
 * order workflow statuses. One stage can contain several approval statuses,
 * while the cycle remains stable as the workflow grows.
 */
export const PRODUCTION_CYCLE_STAGES: ProductionCycleStage[] = [
  {
    key: "foundation",
    number: 0,
    name: "الأساس والحوكمة",
    shortName: "الأساس",
    description: "الأصناف، المواقع، الخطوط، الصلاحيات، والترقيم.",
    statuses: ["new"],
  },
  {
    key: "engineering",
    number: 1,
    name: "التصميم الهندسي",
    shortName: "الهندسة",
    description: "المنتج، الوصفة، خطوات التشغيل، وإصداراتها.",
    statuses: ["pending_supervisor"],
  },
  {
    key: "planning",
    number: 2,
    name: "التخطيط و MRP",
    shortName: "التخطيط",
    description: "تحويل الطلب إلى خطة تصنيع واحتياجات مواد.",
    statuses: ["materials_requested"],
  },
  {
    key: "procurement",
    number: 3,
    name: "المشتريات والاستلام",
    shortName: "التوريد",
    description: "الاستلام، أرقام التشغيلات، والحجر والجودة.",
    statuses: ["materials_rejected"],
  },
  {
    key: "materials",
    number: 4,
    name: "المواد و WIP",
    shortName: "المواد",
    description: "الحجز والتجهيز والتحويل إلى منطقة التشغيل.",
    statuses: ["materials_partial"],
  },
  {
    key: "scheduling",
    number: 5,
    name: "الجدولة وتجهيز الخط",
    shortName: "الجدولة",
    description: "الطاقة، الورديات، الماكينات، وتجهيز الخط.",
    statuses: ["materials_approved"],
  },
  {
    key: "execution",
    number: 6,
    name: "تنفيذ التصنيع",
    shortName: "التنفيذ",
    description: "الدفعات، الكميات، العمالة، والتوقفات.",
    statuses: ["in_production"],
  },
  {
    key: "quality",
    number: 7,
    name: "الجودة",
    shortName: "الجودة",
    description: "الفحص داخل العملية والفحص النهائي والإطلاق.",
    statuses: ["quality_check"],
  },
  {
    key: "ncr",
    number: 8,
    name: "NCR وإعادة التشغيل",
    shortName: "المعالجة",
    description: "العزل، الهالك، إعادة التشغيل، و CAPA.",
    statuses: [],
  },
  {
    key: "delivery",
    number: 9,
    name: "المنتج التام والتتبع",
    shortName: "التسليم",
    description: "التخزين، التخصيص، الشحن، والتتبع العكسي.",
    statuses: [
      "completed",
      "delivery_pending_customer",
      "delivery_pending_warehouse",
      "delivered_customer",
      "delivered_warehouse",
    ],
  },
  {
    key: "costing",
    number: 10,
    name: "التكلفة والمؤشرات",
    shortName: "التحسين",
    description: "التكلفة الفعلية، KPI، وقرارات التحسين.",
    statuses: [],
  },
];

export function getCycleStage(
  workflowStatus: string,
  currentStage?: string | null,
): ProductionCycleStage {
  if (workflowStatus === "cancelled") {
    return PRODUCTION_CYCLE_STAGES[0];
  }

  const byStatus = PRODUCTION_CYCLE_STAGES.find((stage) =>
    stage.statuses.includes(workflowStatus),
  );
  if (byStatus) return byStatus;

  if (currentStage) {
    const normalized = currentStage.toLowerCase().replace(/[\s-]+/g, "_");
    const byKey = PRODUCTION_CYCLE_STAGES.find(
      (stage) => stage.key === normalized || stage.shortName === currentStage,
    );
    if (byKey) return byKey;
  }

  return PRODUCTION_CYCLE_STAGES[0];
}
