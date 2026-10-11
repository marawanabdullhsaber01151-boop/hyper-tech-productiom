export type CompanyStatus = "not_activated" | "active" | "suspended";
export type HealthLevel = "critical" | "new" | "warning" | "healthy";

export interface CompanyRow {
  id: number;
  companyName: string;
  ownerName: string;
  phone: string;
  email: string | null;
  governorate: string | null;
  status: CompanyStatus;
  contactId: number;
  segment: string | null;
  minimumOrderQuantity: number;
  salesUserId: number | null;
  salesName: string | null;
  membersCount: number;
  pendingJoin: number;
  ordersCount: number;
  lastOrderAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  health: { level: HealthLevel; label: string; daysSinceLastOrder: number | null };
}
export interface ListResponse {
  items: CompanyRow[];
  total: number;
  page: number;
  pageSize: number;
}
export interface Meta {
  salesUsers: Array<{ id: number; fullName: string; role: string }>;
  segments: string[];
  governorates: string[];
}
export interface Override {
  permissionKey: string;
  effect: "allow" | "deny";
}
export interface Member {
  memberId: number;
  userId: number;
  status: string;
  isOwner: boolean;
  joinedVia: string;
  title: string | null;
  limits: Record<string, number>;
  lastActiveAt: string | null;
  createdAt: string;
  roleKey: string;
  roleName: string;
  fullName: string;
  phone: string;
  email: string | null;
  mustChangePassword: boolean;
  overrides: Override[];
}
export interface RoleDef {
  key: string;
  name: string;
  permissions: string[];
}
export type SettingKind = "boolean" | "number" | "text" | "choice" | "multi" | "whatsapp" | "json";
export interface SettingShape {
  kind: SettingKind;
  options?: string[];
  nullable?: boolean;
  min?: number;
  max?: number;
}
export interface CompanySetting {
  key: string;
  label: string;
  description: string;
  group: string;
  value: unknown;
  default: unknown;
  source: "company" | "inherited";
  shape: SettingShape;
}
export interface SessionRow {
  id: number;
  memberId: number | null;
  deviceLabel: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  createdAt: string;
}
export interface OrderRow {
  id: number;
  orderNumber: string;
  status: string;
  createdAt: string;
}
export interface CompanyDetail {
  company: CompanyRow;
  members: Member[];
  roles: RoleDef[];
  recentOrders: OrderRow[];
  joinCode: { code: string; expiresAt: string | null; maxUses: number | null; uses: number } | null;
  settings: CompanySetting[];
  sessions: SessionRow[];
}
export interface AuditItem {
  id: number;
  action: string;
  actorName: string;
  actorKind: "staff" | "member";
  targetName: string | null;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}
export interface AuditResponse {
  items: AuditItem[];
  total: number;
  page: number;
  pageSize: number;
}
export interface PermCatalog {
  groups: Array<{ key: string; label: string }>;
  permissions: Array<{ key: string; group: string; label: string; description: string; dangerous: boolean }>;
}
export interface GlobalSettingDef {
  key: string;
  label: string;
  description: string;
  group: string;
  default: unknown;
  shape: SettingShape;
  editableBy: string[];
}
export interface GlobalSettings {
  catalog: GlobalSettingDef[];
  values: Array<{ key: string; value: unknown; updatedBy: string | null; updatedAt: string }>;
}
export interface HistoryItem {
  id: number;
  key: string;
  beforeValue: unknown;
  afterValue: unknown;
  hadBefore: boolean;
  hasAfter: boolean;
  changedByName: string;
  revertedOf: number | null;
  createdAt: string;
}
export interface OutboxItem {
  id: number;
  purpose: string;
  channel: string;
  status: string;
  maskedDestination: string | null;
  createdAt: string;
}
