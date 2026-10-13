/** @format */
/**
 * Plan 07 — pure helpers for activation requests: rank existing contacts
 * (customers already in the ERP) against what the person typed.
 */
import { matchRecord, slaState, type MatchResult } from "./applicationMatching";
import { normalizePhone } from "./identityNormalization";

export type ContactLite = {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
};

export type RankedContact = ContactLite & MatchResult & { alreadyLinked: boolean };

/** Best match first. Contacts that already own a portal account are kept but flagged. */
export function rankContacts(
  request: { companyName: string; phone: string },
  contacts: ContactLite[],
  linkedContactIds: Set<number>,
  limit = 8,
): RankedContact[] {
  const out: RankedContact[] = [];
  for (const c of contacts) {
    const m = matchRecord(
      { phone: request.phone, companyName: request.companyName },
      { phone: c.phone, email: c.email, name: c.company || c.name },
    );
    if (m) out.push({ ...c, ...m, alreadyLinked: linkedContactIds.has(c.id) });
  }
  return out
    .sort((a, b) => Number(a.alreadyLinked) - Number(b.alreadyLinked) || b.score - a.score)
    .slice(0, limit);
}

/** Same phone (after normalization) means it is the same pending request. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  return !!x && x === y;
}

export type ActivationSla = "ok" | "warn" | "late" | "done";

export function activationSla(
  createdAt: Date,
  status: string,
  limits: { warnHours: number; lateHours: number },
): { state: ActivationSla; ageHours: number } {
  return slaState(createdAt, status === "pending" ? "new" : "approved", limits);
}
