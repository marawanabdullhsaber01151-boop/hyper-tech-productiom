/** @format */
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

/** Vercel Cron بيبعت `Authorization: Bearer $CRON_SECRET`. المقارنة بزمن ثابت، والسر لازم يكون مضبوط. */
export function assertCronAuth(req: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw Object.assign(new Error("CRON_SECRET غير مضبوط"), { status: 503 });
  const given = Buffer.from(req.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw Object.assign(new Error("غير مصرح"), { status: 401 });
  }
}
