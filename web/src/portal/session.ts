import { ApiError } from "../api/client";
import { portalSession } from "../auth/portalSession";
import { api, setOnExpired } from "./api";
import { createStore, useStore } from "./lib/store";
import type { LoginChoice, LoginPayload, PortalCustomer, PortalMember } from "./types";

export interface AuthState {
  status: "loading" | "anon" | "authed";
  customer: PortalCustomer | null;
  member: PortalMember | null;
  mustChangePassword: boolean;
}

export const authStore = createStore<AuthState>({ status: "loading", customer: null, member: null, mustChangePassword: false });
export const useAuth = () => useStore(authStore);

/** صلاحية الموظف الحالي. الحماية الحقيقية على السيرفر، ده للإخفاء بس. */
export function can(key: string): boolean {
  const m = authStore.get().member;
  return !!m && (m.isOwner || m.permissions.includes(key));
}

function applyPayload(p: LoginPayload) {
  portalSession.save({ token: p.token, rememberMe: p.rememberMe, customer: p.customer, member: p.member, mustChangePassword: p.mustChangePassword });
  authStore.set({ status: "authed", customer: p.customer, member: p.member, mustChangePassword: p.mustChangePassword });
}

export function signOutLocal() {
  portalSession.clear();
  authStore.set({ status: "anon", customer: null, member: null, mustChangePassword: false });
}

setOnExpired(() => authStore.set({ status: "anon", customer: null, member: null, mustChangePassword: false }));

export async function bootstrap(): Promise<void> {
  const s = portalSession.get();
  if (!s) {
    authStore.set({ status: "anon" });
    return;
  }
  authStore.set({
    status: "authed",
    customer: (s.customer as PortalCustomer) ?? null,
    member: (s.member as PortalMember) ?? null,
    mustChangePassword: s.mustChangePassword === true,
  });
  try {
    const me = await api.get<{ id: number; fullName: string; phone: string; email: string | null; companyName: string; mustChangePassword: boolean; member: PortalMember | null }>("/portal/me");
    const customer: PortalCustomer = { id: me.id, fullName: me.fullName, phone: me.phone, email: me.email, companyName: me.companyName };
    const member = me.member ? { ...(s.member as PortalMember | undefined), ...me.member } : ((s.member as PortalMember) ?? null);
    portalSession.save({ ...s, customer, member, mustChangePassword: me.mustChangePassword });
    authStore.set({ status: "authed", customer, member, mustChangePassword: me.mustChangePassword });
  } catch (e) {
    // 401 بيتعامل معاه الـ client. أي خطأ تاني (شبكة) مش بيطلّعنا من الجلسة.
    if (e instanceof ApiError && e.kind === "unauthorized") signOutLocal();
  }
}

export async function login(identifier: string, password: string, rememberMe: boolean): Promise<LoginChoice | null> {
  const r = await api.post<LoginPayload | LoginChoice>("/portal/login", { identifier, password, rememberMe }, { anonymous: true });
  if ("needsCompanyChoice" in r) return r;
  applyPayload(r);
  return null;
}

export async function chooseCompany(choiceToken: string, companyId: number): Promise<void> {
  applyPayload(await api.post<LoginPayload>("/portal/login/choose-company", { choiceToken, companyId }, { anonymous: true }));
}

export async function switchCompany(companyId: number): Promise<void> {
  applyPayload(await api.post<LoginPayload>("/portal/session/switch-company", { companyId }));
}

export async function logout(): Promise<void> {
  try {
    await api.post("/portal/logout");
  } catch {
    /* خارجين في كل الأحوال */
  }
  signOutLocal();
}
