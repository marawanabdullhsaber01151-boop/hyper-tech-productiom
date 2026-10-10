export interface PortalMember {
  id: number;
  isOwner: boolean;
  roleKey: string;
  roleName?: string;
  permissions: string[];
  limits: Record<string, number | undefined>;
}
export interface PortalCustomer {
  id: number;
  fullName: string;
  phone: string;
  email: string | null;
  companyName: string;
}
export interface CompanyChoice {
  companyId: number;
  companyName: string;
  roleName: string;
  isOwner: boolean;
}
export interface LoginPayload {
  token: string;
  rememberMe: boolean;
  customer: PortalCustomer;
  member: PortalMember;
  mustChangePassword: boolean;
}
export interface LoginChoice {
  needsCompanyChoice: true;
  choiceToken: string;
  companies: CompanyChoice[];
}
export interface Product {
  id: number;
  productCode: string;
  productName: string;
  baseUnit?: string;
  description: string | null;
  primaryImage: string | null;
  orderCount: number;
}
export interface ProductDetail extends Product {
  componentsCount: number;
  secondaryImages: string[];
  featuredIngredients: Array<{ name?: string; materialName?: string; imageData?: string | null; image?: string | null }>;
  cartonConversion: { cartonUnit: string; piecesPerCarton: number } | null;
}
export interface CartItem {
  id: number;
  recipeId: number;
  productName: string;
  productCode: string;
  qty: string;
  available: boolean;
}
export interface TimelineStep {
  key: string;
  label: string;
  state: "reached" | "current" | "upcoming";
  at: string | null;
}
export interface OrderItem {
  id: number;
  orderNumber: string;
  productName: string;
  productCode: string | null;
  bomRecipeId: number | null;
  qty: string;
  unit: string;
  workflowStatus: string;
  referenceLineTotal: string | null;
  suggestedDueDate: string | null;
  timeline: TimelineStep[];
  rejection: { type: string; reason: string | null } | null;
  canCancel: boolean;
  lateCancel: boolean;
  submittedBy: { memberId: number; name: string | null; isMe: boolean } | null;
}
export type RollupStatus = "all_cancelled" | "needs_attention" | "all_completed" | "in_progress" | "pending_review";
export interface OrderBatch {
  batchRef: string;
  createdAt: string;
  overallStatus: RollupStatus;
  items: OrderItem[];
  review: { status: string; replyMessage: string | null; rejectReason: string | null; expectedDelivery: string | null } | null;
}
export interface Paged<T> {
  data: T[];
  pagination: { page: number; limit: number; hasMore: boolean };
}
export interface PortalNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  referenceType: string | null;
  referenceId: number | null;
}
export interface PortalSessionInfo {
  id: number;
  deviceLabel: string;
  ipAddress: string | null;
  lastActiveAt: string;
  current: boolean;
}
export interface ChannelsInfo {
  channels: Array<{ id: number; type: string; masked: string; verified: boolean; primary: boolean }>;
  recoveryCodesLeft: number;
  telegramBot: string | null;
}

export interface TeamMember {
  memberId: number;
  userId: number;
  status: "active" | "suspended" | "invited" | "pending_approval";
  isOwner: boolean;
  joinedVia: string;
  title: string | null;
  lastActiveAt: string | null;
  roleKey: string;
  roleName: string;
  fullName: string;
  phone: string;
  email: string | null;
}
export interface TeamRole {
  id: number;
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
}
export interface CompanyInfo {
  company: { id: number; companyName: string; city: string | null };
  joinCode: { code: string; expiresAt: string | null; maxUses: number | null; uses: number } | null;
  settings: Record<string, unknown>;
}
export interface AuditEvent {
  id: number;
  action: string;
  actorMemberId: number | null;
  actorLabel: string | null;
  createdAt: string;
}
