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
export type SettingKind = "boolean" | "number" | "text" | "choice" | "multi" | "whatsapp" | "list" | "json";
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

/* ---------- طلبات الانضمام (Plan 06) ---------- */
export type AppStage = "new" | "needs_info" | "ready" | "approved" | "rejected" | "duplicate_auto_closed";
export type AppSla = "ok" | "warn" | "late" | "done";
export interface AppRow {
  id: number;
  referenceCode: string;
  fullName: string;
  companyName: string;
  phone: string;
  email: string | null;
  address: string;
  city: string | null;
  commercialRegisterNo: string | null;
  taxId: string | null;
  expectedMonthlyVolume: string | null;
  notes: string | null;
  stage: AppStage;
  reviewerNote: string | null;
  internalNotes: string | null;
  completeness: number;
  missing: string[];
  assignedReviewerId: number | null;
  assignedReviewerName: string | null;
  decision: string | null;
  approvedCompanyId: number | null;
  sla: AppSla;
  ageHours: number;
  createdAt: string;
  hasDuplicate?: boolean;
}
export interface AppList {
  items: AppRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<AppStage, number>;
}
export interface AppMeta {
  reviewers: Array<{ id: number; fullName: string; role: string }>;
  segments: string[];
  rejectTemplates: string[];
  infoTemplates: string[];
  sla: { warnHours: number; lateHours: number };
  defaults: { joinMode: string; chatMode: string; maxMembers: number; defaultRole: string; minOrderQty: number };
}
export type MatchReason = "phone" | "email" | "name";
interface MatchBase {
  id: number;
  name: string;
  phone: string | null;
  reasons: MatchReason[];
  confidence: "high" | "medium" | "low";
  score: number;
}
export interface AppMatches {
  companies: Array<MatchBase & { kind: "company"; active: boolean }>;
  contacts: Array<MatchBase & { kind: "contact"; contactName: string; alreadyLinked: boolean }>;
  applications: Array<MatchBase & { kind: "application"; referenceCode: string; stage: AppStage }>;
  userPhoneTaken: boolean;
  userEmailTaken: boolean;
}
export interface AppEvent {
  id: number;
  kind: string;
  stageFrom: string | null;
  stageTo: string | null;
  actorLabel: string;
  note: string | null;
  createdAt: string;
}
export interface AppDetail {
  application: AppRow;
  matches: AppMatches;
  events: AppEvent[];
}
export interface ApproveResult {
  decision: "new_company" | "join_company" | "link_contact";
  companyId: number;
  activation?: { url: string; whatsappUrl: string | null; message: string; delivered: boolean } | null;
  tempPassword?: string;
  whatsappUrl?: string | null;
  message?: string;
}

/* ---- Plan 07: طلبات التفعيل ---- */
export type ActStatus = "pending" | "confirmed" | "rejected" | "closed";
export interface ActRow {
  id: number;
  companyNameEntered: string;
  phoneEntered: string;
  status: ActStatus;
  matchedContactId: number | null;
  matchedPortalCustomerId: number | null;
  matchedContact?: { id: number; name: string; company: string | null; phone: string | null } | null;
  rejectionReason: string | null;
  closeReason: string | null;
  internalNotes: string | null;
  assignedReviewerId: number | null;
  assignedReviewerName: string | null;
  requestCount: number;
  lastRequestedAt: string;
  decidedAt: string | null;
  createdAt: string;
  sla: "ok" | "warn" | "late" | "done";
  ageHours: number;
}
export interface ActList {
  items: ActRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<ActStatus, number>;
}
export interface ActMeta {
  reviewers: Array<{ id: number; fullName: string; role: string }>;
  sla: { warnHours: number; lateHours: number };
}
export interface ActCandidate {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  alreadyLinked: boolean;
  reasons?: Array<"phone" | "email" | "name">;
  confidence?: "high" | "medium" | "low";
  score?: number;
}
export interface ActEvent {
  id: number;
  kind: string;
  actorLabel: string;
  note: string | null;
  createdAt: string;
}
export interface ActDetail {
  request: ActRow;
  candidates: ActCandidate[];
  existingAccount: { id: number; companyName: string; isActive: boolean } | null;
  matchedAccountId: number | null;
  events: ActEvent[];
}
export interface ActActivation {
  url: string;
  whatsappUrl: string | null;
  message: string;
  delivered: boolean;
}
