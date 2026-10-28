/**
 * ✅ تكوين الأقسام المركزي — المصدر الوحيد للحقيقة للتنقل الهرمي بالكامل.
 *
 * البنية 3 مستويات:
 *   القسم (Department) → المحور الوظيفي (Sub-function) → الصفحة (Page)
 *
 * هذا الملف يُستخدم من مكان واحد بس (`GET /api/v1/nav`) عشان يبني شجرة
 * التنقل الديناميكية للفرونت إند حسب دور المستخدم — بدل القائمة الثابتة
 * القديمة اللي كانت بتعرض كل الصفحات لكل الناس.
 *
 * ⚠️ قاعدة مهمة: صلاحيات الوصول هنا (roles) هي للعرض/التنقل فقط
 * (أي قسم/محور/صفحة يظهر لمين في الواجهة). الحماية الحقيقية تبقى دايمًا
 * في الباك إند عبر PERMISSIONS / requireRole / requirePermission على كل
 * route لوحده — هذا الملف لا يغيّر ولا يستبدل تلك الحماية بأي شكل.
 *
 * @format
 */

import type { UserRole } from "./roles";
import { OPERATIONS_CONTROL_ROLES } from "./operations-control-policy";

export interface NavPage {
  id: string;
  label: string;
  href: string;
  roles: readonly UserRole[];
  badgeCount?: number;
}

export interface NavSubFunction {
  id: string;
  label: string;
  roles: readonly UserRole[];
  pages: readonly NavPage[];
}

const OPERATIONS_CASE_VIEW_ROLES = OPERATIONS_CONTROL_ROLES.caseView;

export interface NavDepartment {
  id: string;
  label: string;
  icon: string; // اسم أيقونة Font Awesome، مثال: "chart-line"
  roles: readonly UserRole[];
  subFunctions: readonly NavSubFunction[];
}

const TOP_MGMT: readonly UserRole[] = ["chairman", "executive_manager"];

export const DEPARTMENTS: readonly NavDepartment[] = [
  {
    id: "top-management",
    label: "الإدارة العليا",
    icon: "landmark",
    roles: TOP_MGMT,
    subFunctions: [
      {
        id: "governance",
        label: "الحوكمة والاعتمادات",
        roles: TOP_MGMT,
        pages: [
          { id: "governance", label: "الحوكمة والاعتمادات", href: "governance.html", roles: TOP_MGMT },
          { id: "settings", label: "الإعدادات", href: "settings.html", roles: ["chairman"] },
          // واجهة /v2 بدل صفحة الصحة القديمة (اتمسحت): نفس الفحوصات + فحوصات حقيقية بشرح بسيط.
          { id: "system-health", label: "صحة النظام", href: "/v2/staff/system-health", roles: TOP_MGMT },
        ],
      },
    ],
  },
  {
    id: "foundation-data",
    label: "البيانات الأساسية",
    icon: "database",
    roles: ["chairman", "executive_manager", "operations_manager", "production_manager", "warehouse_manager"],
    subFunctions: [
      {
        id: "foundation-data-main",
        label: "البيانات الأساسية",
        roles: ["chairman", "executive_manager", "operations_manager", "production_manager", "warehouse_manager"],
        pages: [
          { id: "foundation", label: "البيانات الأساسية", href: "foundation.html", roles: ["chairman", "executive_manager", "operations_manager", "production_manager", "warehouse_manager"] },
        ],
      },
    ],
  },
  {
    id: "sales",
    label: "المبيعات",
    icon: "cart-shopping",
    roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"],
    subFunctions: [
      {
        id: "sales-online",
        label: "المبيعات أونلاين (من البوابة)",
        roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "hr", "hr_manager"],
        pages: [
          { id: "sales-online", label: "فواتير الأونلاين", href: "/v2/staff/sales?channel=website", roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "hr", "hr_manager"] },
        ],
      },
      {
        id: "sales-offline",
        label: "المبيعات أوفلاين",
        roles: ["chairman", "executive_manager", "sales_manager", "offline_seller", "hr", "hr_manager"],
        pages: [
          { id: "sales-offline", label: "فواتير الأوفلاين", href: "/v2/staff/sales?channel=direct", roles: ["chairman", "executive_manager", "sales_manager", "offline_seller", "hr", "hr_manager"] },
        ],
      },
      {
        id: "sales-customers",
        label: "العملاء",
        roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"],
        pages: [
          { id: "contacts", label: "الموردون والعملاء", href: "/v2/staff/contacts", roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"] },
          { id: "portal-orders", label: "طلبات بوابة العملاء", href: "/v2/admin/portal-orders", roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"] },
        ],
      },
      {
        id: "sales-production",
        label: "متابعة الإنتاج",
        roles: ["sales_manager", "hr", "hr_manager"],
        pages: [
          { id: "production", label: "أوامر الإنتاج", href: "/v2/staff/production?tab=orders", roles: ["sales_manager", "hr", "hr_manager"] },
        ],
      },
    ],
  },
  {
    id: "production",
    label: "الإنتاج",
    icon: "industry",
    roles: ["chairman", "executive_manager", "operations_manager", "production_manager", "supervisor", "production_controller", "production_quality_controller", "warehouse_manager"],
    subFunctions: [
      {
        id: "production-orders",
        label: "أوامر الإنتاج",
        roles: ["chairman", "executive_manager", "operations_manager", "production_manager", "production_controller", "supervisor"],
        pages: [
          { id: "production", label: "أوامر الإنتاج", href: "/v2/staff/production?tab=orders", roles: ["chairman", "executive_manager", "operations_manager", "production_manager", "production_controller", "supervisor"] },
        ],
      },
      {
        id: "production-control",
        label: "مركز التحكم بالإنتاج",
        roles: ["chairman", "production_manager", "production_controller", "warehouse_manager", "supervisor", "production_quality_controller"],
        pages: [
          { id: "production-control", label: "مركز التحكم بالإنتاج", href: "production-control.html", roles: ["chairman", "production_manager", "production_controller", "warehouse_manager", "supervisor", "production_quality_controller"] },
        ],
      },
      {
        id: "production-requests",
        label: "طلبات الإنتاج",
        roles: ["chairman", "supervisor", "production_manager"],
        pages: [
          { id: "production-requests", label: "طلبات الإنتاج", href: "/v2/staff/production?tab=requests", roles: ["chairman", "supervisor", "production_manager", "warehouse_manager"] },
          { id: "factory-intake", label: "استقبال طلبات الإنتاج", href: "factory-intake.html", roles: ["chairman", "supervisor", "production_manager"] },
        ],
      },
      {
        id: "engineering",
        label: "الهندسة وإصدارات المنتج",
        roles: ["chairman", "production_manager", "production_controller", "production_quality_controller"],
        pages: [
          { id: "engineering", label: "الهندسة وإصدارات المنتج", href: "engineering.html", roles: ["chairman", "production_manager", "production_controller", "production_quality_controller"] },
        ],
      },
      {
        id: "execution-control",
        label: "التنفيذ والجودة والتتبع",
        roles: ["chairman", "production_manager", "production_controller", "supervisor", "production_quality_controller"],
        pages: [
          { id: "execution-control", label: "التنفيذ والجودة والتتبع", href: "/v2/staff/production?tab=quality", roles: ["chairman", "production_manager", "production_controller", "supervisor", "production_quality_controller"] },
        ],
      },
      {
        id: "planning",
        label: "التخطيط و MRP",
        roles: ["chairman", "production_manager", "production_controller", "warehouse_manager"],
        pages: [
          { id: "planning", label: "التخطيط و MRP", href: "planning.html", roles: ["chairman", "production_manager", "production_controller", "warehouse_manager"] },
        ],
      },
      {
        id: "bom",
        label: "وصفات التصنيع",
        roles: ["chairman", "hr", "hr_manager", "production_manager", "supervisor", "production_controller"],
        pages: [
          { id: "bom", label: "وصفات التصنيع", href: "bom.html", roles: ["chairman", "hr", "hr_manager", "production_manager", "supervisor", "production_controller"] },
        ],
      },
    ],
  },
  {
    id: "warehouse",
    label: "المخازن",
    icon: "warehouse",
    roles: ["chairman", "warehouse_manager", "storekeeper"],
    subFunctions: [
      {
        id: "warehouse-stock",
        label: "المخزون",
        roles: ["chairman", "warehouse_manager", "storekeeper"],
        pages: [
          { id: "inventory", label: "المخزن", href: "/v2/staff/stock", roles: ["chairman", "warehouse_manager", "storekeeper"] },
          { id: "material", label: "المواد الخام", href: "/v2/staff/stock?cat=raw_material", roles: ["chairman", "warehouse_manager", "storekeeper"] },
          { id: "purchases-receive", label: "استلام أوامر الشراء", href: "/v2/staff/purchases", roles: ["chairman", "warehouse_manager", "storekeeper"] },
          { id: "production-requests-warehouse", label: "طلبات إنتاج بانتظار المخزن", href: "/v2/staff/production?tab=requests", roles: ["chairman", "warehouse_manager", "storekeeper"] },
          { id: "movements", label: "حركات المخزون", href: "/v2/staff/stock?tab=movements", roles: ["chairman", "warehouse_manager", "storekeeper"] },
          { id: "factory-warehouse-manager", label: "قرار خامات أوامر الإنتاج", href: "/v2/staff/production?tab=orders", roles: ["chairman", "warehouse_manager", "storekeeper"] },
        ],
      },
    ],
  },
  {
    id: "purchasing",
    label: "المشتريات",
    icon: "truck-ramp-box",
    roles: ["chairman", "purchasing_manager", "buyer"],
    subFunctions: [
      {
        id: "purchasing-orders",
        label: "أوامر الشراء",
        roles: ["chairman", "purchasing_manager", "buyer"],
        pages: [
          { id: "purchases", label: "الاحتياجات وأوامر الشراء", href: "/v2/staff/purchases", roles: ["chairman", "purchasing_manager", "buyer"] },
        ],
      },
      {
        id: "purchasing-stock",
        label: "المخزون",
        roles: ["chairman", "purchasing_manager", "buyer"],
        pages: [
          // صفحة عرض فقط في الواجهة الجديدة (/v2). صفحات المخزن القديمة فيها أزرار تعديل من غير تحكم بالدور.
          { id: "stock-view", label: "المخزون والمواد الخام", href: "/v2/staff/stock", roles: ["chairman", "purchasing_manager", "buyer"] },
        ],
      },
    ],
  },
  {
    id: "quality",
    label: "الجودة",
    icon: "shield-halved",
    roles: ["chairman", "raw_material_quality_controller", "quality_engineer", "production_quality_controller"],
    subFunctions: [
      {
        id: "quality-control",
        label: "مراقبة الجودة",
        roles: ["chairman", "raw_material_quality_controller", "quality_engineer", "production_quality_controller"],
        pages: [
          { id: "factory-quality-controller", label: "مراقب الجودة", href: "/v2/staff/production?tab=inspect", roles: ["chairman", "raw_material_quality_controller", "quality_engineer", "production_quality_controller"] },
        ],
      },
    ],
  },
  {
    id: "operations",
    label: "العمليات",
    icon: "diagram-project",
    roles: ["chairman", "operations_manager", "executive_manager", "warehouse_manager", "production_manager", "production_controller", "supervisor", "production_quality_controller"],
    subFunctions: [
      {
        id: "operations-hub",
        label: "التحكم في العمليات",
        roles: ["chairman", "operations_manager", "executive_manager", "warehouse_manager", "production_manager", "production_controller", "supervisor", "production_quality_controller"],
        pages: [
          { id: "operations-center", label: "مركز قيادة التشغيل", href: "/v2/staff/operations", roles: OPERATIONS_CASE_VIEW_ROLES },
        ],
      },
    ],
  },
  {
    id: "customer-portal",
    label: "بوابة العملاء",
    icon: "globe",
    roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"],
    subFunctions: [
      {
        id: "portal-chat",
        label: "محادثات العملاء",
        roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"],
        pages: [
          { id: "chat-staff", label: "محادثات العملاء", href: "/v2/admin/portal-chat", roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"] },
        ],
      },
      {
        id: "portal-admin",
        label: "إدارة عملاء البوابة",
        roles: ["chairman", "executive_manager", "sales_manager"],
        pages: [
          { id: "portal-customers-admin", label: "إدارة عملاء البوابة", href: "/v2/admin/portal-customers", roles: ["chairman", "executive_manager", "sales_manager"] },
          { id: "portal-applications-admin", label: "طلبات الانضمام", href: "/v2/admin/portal-applications", roles: ["chairman", "executive_manager", "sales_manager"] },
          { id: "portal-activation-requests-admin", label: "طلبات التفعيل", href: "/v2/admin/portal-activation-requests", roles: ["chairman", "executive_manager", "sales_manager"] },
        ],
      },
    ],
  },
] as const;

/** يفلتر شجرة الأقسام كاملة حسب دور المستخدم — قسم/محور/صفحة يظهروا بس لو دور المستخدم موجود في roles بتاعتهم. */
export function getNavForRole(role: UserRole) {
  return DEPARTMENTS
    .filter((dept) => dept.roles.includes(role))
    .map((dept) => ({
      id: dept.id,
      label: dept.label,
      icon: dept.icon,
      subFunctions: dept.subFunctions
        .filter((sf) => sf.roles.includes(role))
        .map((sf) => ({
          id: sf.id,
          label: sf.label,
          pages: sf.pages.filter((p) => p.roles.includes(role)),
        }))
        .filter((sf) => sf.pages.length > 0),
    }))
    .filter((dept) => dept.subFunctions.length > 0);
}
