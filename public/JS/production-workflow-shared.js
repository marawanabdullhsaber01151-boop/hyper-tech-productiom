/** @format */
/**
 * عقد واجهة دورة الإنتاج المشترك بين لوحات الإنتاج.
 * لا يحتوي على صلاحيات؛ الصلاحيات الفعلية تظل في الخادم.
 */
(function attachProductionWorkflowShared(global) {
  "use strict";

  const statusLabels = Object.freeze({
    new: "جديد",
    pending_supervisor: "في انتظار مشرف الإنتاج",
    materials_requested: "تم طلب المواد الخام",
    materials_approved: "المواد موافق عليها",
    materials_partial: "موافقة جزئية على المواد",
    materials_rejected: "المواد مرفوضة",
    in_production: "قيد التنفيذ",
    quality_check: "فحص الجودة",
    completed: "مكتمل",
    delivery_pending_customer: "بانتظار تسليم العميل",
    delivery_pending_warehouse: "بانتظار استلام المخزن",
    delivered_customer: "تم التسليم للعميل",
    delivered_warehouse: "تم التسليم للمخزن",
    cancelled: "ملغي",
  });

  const productionStages = Object.freeze([
    { id: "line_setup", label: "تجهيز الخط" },
    { id: "manufacturing", label: "تصنيع فعلي" },
    { id: "assembly_packing", label: "تجميع وتغليف" },
    { id: "ready_for_quality", label: "جاهز لفحص الجودة" },
  ]);

  global.HyperTechProduction = Object.freeze({
    statusLabels,
    productionStages,
    deliveredStatuses: Object.freeze([
      "delivered_customer",
      "delivered_warehouse",
    ]),
    terminalStatuses: Object.freeze([
      "delivered_customer",
      "delivered_warehouse",
      "cancelled",
    ]),
    labelForStatus(status) {
      return statusLabels[status] || status || "غير محدد";
    },
  });
})(window);