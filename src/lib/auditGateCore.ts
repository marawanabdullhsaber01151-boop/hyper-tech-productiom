/** @format */
// بوابة npm audit (Q2): بتفشل على أي ثغرة high/critical إلا اللي مسموح بيها صراحة، بسبب مكتوب وتاريخ انتهاء. نقي من غير شبكة.

export interface AllowEntry { id: string; package: string; reason: string; expires: string }
export interface GateFinding { pkg: string; id: string; severity: string; title: string }
export interface GateResult { blocked: GateFinding[]; allowed: GateFinding[]; expired: GateFinding[] }

const RANK: Record<string, number> = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const ghsaOf = (url: unknown): string | null => (typeof url === "string" ? url.match(/GHSA-[a-z0-9-]+/i)?.[0]?.toUpperCase() ?? null : null);

/** audit = ناتج `npm audit --json`. today = YYYY-MM-DD. minSeverity الافتراضي high. */
export function evaluateAudit(audit: unknown, allow: readonly AllowEntry[], today: string, minSeverity: "high" | "critical" = "high"): GateResult {
  const out: GateResult = { blocked: [], allowed: [], expired: [] };
  const vulns = (audit as { vulnerabilities?: Record<string, { via?: unknown[] }> } | null)?.vulnerabilities ?? {};
  const seen = new Set<string>();
  for (const [pkg, v] of Object.entries(vulns)) {
    for (const via of v.via ?? []) {
      if (!via || typeof via !== "object") continue; // نصوص = ثغرة موروثة، والمصدر بيتعدّ عند صاحبه
      const o = via as { severity?: string; title?: string; url?: string };
      const id = ghsaOf(o.url);
      if (!id || (RANK[o.severity ?? "info"] ?? 0) < RANK[minSeverity]) continue;
      const key = `${pkg}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const finding: GateFinding = { pkg, id, severity: o.severity ?? "", title: o.title ?? "" };
      const entry = allow.find((a) => a.id.toUpperCase() === id);
      if (!entry) out.blocked.push(finding);
      else if (entry.expires < today) out.expired.push(finding);
      else out.allowed.push(finding);
    }
  }
  return out;
}

export const gateFails = (r: GateResult): boolean => r.blocked.length > 0 || r.expired.length > 0;
