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
        label: "المبيعات أونلاين",
        roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "hr", "hr_manager"],
        pages: [
          { id: "sales", label: "المبيعات", href: "sales.html", roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "hr", "hr_manager"] },
        ],
      },
      {
        id: "sales-offline",
        label: "المبيعات أوفلاين",
        roles: ["chairman", "executive_manager", "sales_manager", "offline_seller", "hr", "hr_manager"],
        pages: [
          { id: "sales", label: "المبيعات", href: "sales.html", roles: ["chairman", "executive_manager", "sales_manager", "offline_seller", "hr", "hr_manager"] },
        ],
      },
      {
        id: "sales-customers",
        label: "العملاء",
        roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"],
        pages: [
          { id: "contacts", label: "الموردون والعملاء", href: "contacts.html", roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"] },
          { id: "portal-orders", label: "طلبات بوابة العملاء", href: "portal-orders.html", roles: ["chairman", "executive_manager", "sales_manager", "online_seller", "offline_seller", "hr", "hr_manager"] },
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
        roles: ["chairman", "executive_manager", "operations_manager", "production_manager", "production_controller"],
        pages: [
          { id: "production", label: "أوامر الإنتاج", href: "production.html", roles: ["chairman", "executive_manager", "operations_manager", "production_manager", "production_controller"] },
          { id: "factory-production-manager", label: "لوحة مدير الإنتاج", href: "factory-production-manager.html", roles: ["chairman", "executive_manager", "production_manager", "operations_manager"] },
          { id: "factory-supervisor", label: "لوحة المشرف", href: "factory-supervisor.html", roles: ["chairman", "production_manager", "supervisor"] },
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
          { id: "production-requests", label: "طلبات الإنتاج", href: "production-requests.html", roles: ["chairman", "supervisor", "production_manager"] },
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
          { id: "execution-control", label: "التنفيذ والجودة والتتبع", href: "execution-control.html", roles: ["chairman", "production_manager", "production_controller", "supervisor", "production_quality_controller"] },
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
          { id: "inventory", label: "المخزن", href: "inventory.html", roles: ["chairman", "warehouse_manager", "storekeeper"] },
          { id: "material", label: "المواد الخام", href: "material.html", roles: ["chairman", "warehouse_manager", "storekeeper"] },
          { id: "movements", label: "حركات المخزون", href: "movements.html", roles: ["chairman", "warehouse_manager", "storekeeper"] },
          { id: "factory-warehouse-manager", label: "لوحة مدير المخازن", href: "factory-warehouse-manager.html", roles: ["chairman", "warehouse_manager", "operations_manager"] },
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
          { id: "factory-quality-controller", label: "مراقب الجودة", href: "factory-quality-controller.html", roles: ["chairman", "raw_material_quality_controller", "quality_engineer", "production_quality_controller"] },
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
          { id: "operations", label: "التحكم في العمليات", href: "operations.html", roles: ["chairman", "operations_manager", "executive_manager", "warehouse_manager", "production_manager", "production_controller", "supervisor", "production_quality_controller"] },
          { id: "operations-manager-inbox", label: "مراجعة واستقبال أوامر البيع التشغيلية", href: "operations-manager.html", roles: OPERATIONS_CASE_VIEW_ROLES },
        ],
      },
    ],
  },
  {
    id: "customer-portal",
    label: "بوابة العملاء",
    icon: "globe",
    roles: ["chairman", "executive_manager", "sales_manager"],
    subFunctions: [
      {
        id: "portal-admin",
        label: "إدارة عملاء البوابة",
        roles: ["chairman", "executive_manager", "sales_manager"],
        pages: [
          { id: "portal-customers-admin", label: "إدارة عملاء البوابة", href: "portal-customers-admin.html", roles: ["chairman", "executive_manager", "sales_manager"] },
          { id: "portal-applications-admin", label: "طلبات الانضمام", href: "portal-applications-admin.html", roles: ["chairman", "executive_manager", "sales_manager"] },
          { id: "portal-activation-requests-admin", label: "طلبات التفعيل", href: "portal-activation-requests-admin.html", roles: ["chairman", "executive_manager", "sales_manager"] },
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
