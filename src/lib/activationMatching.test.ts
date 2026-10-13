/** @format */
import { describe, expect, it } from "vitest";
import { activationSla, rankContacts, samePhone } from "./activationMatching";

const contacts = [
  { id: 1, name: "أحمد", company: "شركة النور للتجارة", phone: "01011112222", email: null },
  { id: 2, name: "منى", company: "مصنع الأمل", phone: "01099998888", email: null },
  { id: 3, name: "سمير", company: "شركة النور", phone: "01234567890", email: null },
];

describe("rankContacts", () => {
  it("ranks phone match first and ignores unrelated contacts", () => {
    const r = rankContacts({ companyName: "النور", phone: "+201011112222" }, contacts, new Set());
    expect(r[0]!.id).toBe(1);
    expect(r.find((x) => x.id === 2)).toBeUndefined();
  });
  it("pushes already-linked contacts to the end", () => {
    const r = rankContacts({ companyName: "شركة النور", phone: "01011112222" }, contacts, new Set([1]));
    expect(r[r.length - 1]!.id).toBe(1);
    expect(r[r.length - 1]!.alreadyLinked).toBe(true);
  });
});

describe("samePhone / sla", () => {
  it("compares phones after normalization", () => {
    expect(samePhone("0101 111 2222", "+201011112222")).toBe(true);
    expect(samePhone("", "")).toBe(false);
  });
  it("is done once decided", () => {
    const old = new Date(Date.now() - 100 * 3600_000);
    expect(activationSla(old, "confirmed", { warnHours: 24, lateHours: 48 }).state).toBe("done");
    expect(activationSla(old, "pending", { warnHours: 24, lateHours: 48 }).state).toBe("late");
  });
});
