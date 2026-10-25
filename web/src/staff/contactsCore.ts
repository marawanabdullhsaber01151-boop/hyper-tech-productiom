import { CONTACT_WRITE_ROLES } from "./staffRoles";

/** منطق جهات الاتصال النقي: الفلترة والترتيب والروابط والتحقق، من غير شاشة. */
export const CONTACT_TYPES = ["customer", "supplier", "both"] as const;
export const SEGMENTS = ["new", "standard", "preferred", "strategic"] as const;
export type TypeTab = "all" | "customer" | "supplier";
export type SortKey = "name" | "recent" | "activity";

export interface ContactRow {
  id: number;
  type: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  segment: string | null;
  notes: string | null;
  ownerUserId: number | null;
  createdAt: string;
  salesCount: number;
  poCount: number;
}

export interface ContactDraft {
  type: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  city: string;
  segment: string;
  address: string;
  notes: string;
}

export const emptyDraft = (type = "customer"): ContactDraft => ({ type, name: "", company: "", phone: "", email: "", city: "", segment: "", address: "", notes: "" });
export const draftOf = (c: ContactRow): ContactDraft => ({
  type: c.type,
  name: c.name,
  company: c.company ?? "",
  phone: c.phone ?? "",
  email: c.email ?? "",
  city: c.city ?? "",
  segment: c.segment ?? "",
  address: c.address ?? "",
  notes: c.notes ?? "",
});

export const isSupplier = (c: Pick<ContactRow, "type">) => c.type === "supplier" || c.type === "both";
export const isCustomer = (c: Pick<ContactRow, "type">) => c.type === "customer" || c.type === "both";
export const isSellerRole = (role: string) => role === "online_seller" || role === "offline_seller";
export const canWriteContacts = (role: string) => (CONTACT_WRITE_ROLES as readonly string[]).includes(role);

export function contactCounts(rows: ContactRow[]) {
  return { total: rows.length, suppliers: rows.filter(isSupplier).length, customers: rows.filter(isCustomer).length, both: rows.filter((r) => r.type === "both").length };
}

const digitsOf = (v: string) =>
  v
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");

export function filterContacts(rows: ContactRow[], f: { tab: TypeTab; search: string; city: string; segment: string }): ContactRow[] {
  const q = f.search.trim().toLowerCase();
  const qd = digitsOf(q);
  return rows.filter((c) => {
    if (f.tab === "supplier" && !isSupplier(c)) return false;
    if (f.tab === "customer" && !isCustomer(c)) return false;
    if (f.city && c.city !== f.city) return false;
    if (f.segment && c.segment !== f.segment) return false;
    if (!q) return true;
    const text = `${c.name} ${c.company ?? ""} ${c.city ?? ""} ${c.email ?? ""}`.toLowerCase();
    return text.includes(q) || (qd.length >= 3 && digitsOf(c.phone ?? "").includes(qd));
  });
}

export function sortContacts(rows: ContactRow[], key: SortKey): ContactRow[] {
  const out = [...rows];
  if (key === "name") out.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  else if (key === "recent") out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else out.sort((a, b) => b.salesCount + b.poCount - (a.salesCount + a.poCount) || a.name.localeCompare(b.name, "ar"));
  return out;
}

/** رقم دولي لواتساب: 01001234567 ← 201001234567. بيرجّع null لو الرقم مش صالح. */
export function intlPhone(raw: string | null | undefined): string | null {
  let d = digitsOf(raw ?? "");
  if (d.startsWith("0020")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return `20${d.slice(1)}`;
  if (d.length === 10 && d.startsWith("1")) return `20${d}`;
  if (d.length === 12 && d.startsWith("20")) return d;
  return d.length >= 8 && d.length <= 15 ? d : null;
}
export const telLink = (raw: string | null | undefined) => {
  const n = intlPhone(raw);
  return n ? `tel:+${n}` : null;
};
export const waLink = (raw: string | null | undefined) => {
  const n = intlPhone(raw);
  return n ? `https://wa.me/${n}` : null;
};

export type DraftErrors = { name: boolean; phone: boolean; email: boolean };
export function draftErrors(d: ContactDraft): DraftErrors {
  const phone = d.phone.trim();
  const email = d.email.trim();
  return {
    name: !d.name.trim(),
    phone: phone !== "" && intlPhone(phone) === null,
    email: email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email),
  };
}

const nul = (v: string) => (v.trim() ? v.trim() : null);
export function toBody(d: ContactDraft) {
  return {
    type: d.type,
    name: d.name.trim(),
    company: nul(d.company),
    phone: nul(d.phone),
    email: nul(d.email),
    city: d.city || null,
    segment: d.segment || null,
    address: nul(d.address),
    notes: nul(d.notes),
  };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0]![0]}${parts[1]![0]}`;
  return name.trim().slice(0, 2);
}
