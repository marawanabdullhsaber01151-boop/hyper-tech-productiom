/** @format */
/**
 * Company list for the admin command center. One query, no N+1: every
 * aggregate is a correlated subquery inside a single derived table, then the
 * filters / sort / page run on top of it.
 */
import { sql, SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { customerHealth } from "./customerHealth";
import { normalizeCompanyCode } from "./companyCode";

export const COMPANY_STATUSES = ["not_activated", "active", "suspended"] as const;

export const companyListQuery = z.object({
  q: z.string().trim().max(100).default(""),
  status: z.enum(["all", ...COMPANY_STATUSES]).default("all"),
  needsFollowUp: z.enum(["1", "0"]).optional(),
  noSales: z.enum(["1", "0"]).optional(),
  hasPendingJoin: z.enum(["1", "0"]).optional(),
  governorate: z.string().trim().max(60).optional(),
  segment: z.string().trim().max(60).optional(),
  salesUserId: z.coerce.number().int().positive().optional(),
  sort: z
    .enum(["created", "name", "lastOrder", "lastActivity", "members"])
    .default("created"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CompanyListQuery = z.infer<typeof companyListQuery>;

const SORT_SQL: Record<CompanyListQuery["sort"], string> = {
  created: "t.created_at",
  name: "t.company_name",
  lastOrder: "t.last_order_at",
  lastActivity: "t.last_activity_at",
  members: "t.members_count",
};

function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function companyFilters(f: CompanyListQuery): SQL[] {
  const w: SQL[] = [];
  if (f.q) {
    const like = `%${likeEscape(f.q)}%`;
    const code = normalizeCompanyCode(f.q);
    w.push(sql`(
      t.company_name ILIKE ${like} OR t.owner_name ILIKE ${like} OR t.phone ILIKE ${like}
      OR EXISTS (
        SELECT 1 FROM portal_members pm JOIN portal_users pu ON pu.id = pm.user_id
        WHERE pm.company_id = t.id AND pm.status <> 'removed'
          AND (pu.full_name ILIKE ${like} OR pu.phone ILIKE ${like} OR pu.email ILIKE ${like})
      )
      ${code ? sql`OR EXISTS (SELECT 1 FROM portal_company_codes cc WHERE cc.company_id = t.id AND cc.code = ${code})` : sql``}
    )`);
  }
  if (f.status === "not_activated") w.push(sql`t.activated_at IS NULL`);
  if (f.status === "active") w.push(sql`t.activated_at IS NOT NULL AND t.is_active`);
  if (f.status === "suspended") w.push(sql`NOT t.is_active`);
  if (f.needsFollowUp === "1") {
    w.push(sql`(
      (t.credit_limit IS NOT NULL AND t.credit_limit::numeric > 0 AND COALESCE(t.balance::numeric,0) / t.credit_limit::numeric >= 0.8)
      OR (t.last_order_at IS NOT NULL AND t.last_order_at < now() - interval '90 days')
    )`);
  }
  if (f.noSales === "1") w.push(sql`t.assigned_sales_user_id IS NULL`);
  if (f.hasPendingJoin === "1") w.push(sql`t.pending_join > 0`);
  if (f.governorate) w.push(sql`t.city = ${f.governorate}`);
  if (f.segment) w.push(sql`t.segment = ${f.segment}`);
  if (f.salesUserId) w.push(sql`t.assigned_sales_user_id = ${f.salesUserId}`);
  return w;
}

const BASE = sql`
  SELECT
    c.id, c.company_name, c.full_name AS owner_name, c.phone, c.email, c.city,
    c.is_active, c.activated_at, c.created_at, c.contact_id,
    c.minimum_order_quantity, c.assigned_sales_user_id,
    su.full_name AS sales_name,
    ct.segment, ct.balance, ct.credit_limit,
    (SELECT count(*)::int FROM portal_members m
       WHERE m.company_id = c.id AND m.status IN ('active','invited','pending_approval')) AS members_count,
    (SELECT count(*)::int FROM portal_members m
       WHERE m.company_id = c.id AND m.status = 'pending_approval') AS pending_join,
    (SELECT max(m.last_active_at) FROM portal_members m WHERE m.company_id = c.id) AS last_activity_at,
    (SELECT max(o.created_at) FROM sales_orders o WHERE o.contact_id = c.contact_id) AS last_order_at,
    (SELECT count(*)::int FROM sales_orders o WHERE o.contact_id = c.contact_id) AS orders_count
  FROM portal_customers c
  LEFT JOIN contacts ct ON ct.id = c.contact_id
  LEFT JOIN system_users su ON su.id = c.assigned_sales_user_id
`;

export type CompanyRow = {
  id: number;
  company_name: string;
  owner_name: string;
  phone: string;
  email: string | null;
  city: string | null;
  is_active: boolean;
  activated_at: Date | null;
  created_at: Date;
  contact_id: number;
  minimum_order_quantity: number;
  assigned_sales_user_id: number | null;
  sales_name: string | null;
  segment: string | null;
  balance: string | null;
  credit_limit: string | null;
  members_count: number;
  pending_join: number;
  last_activity_at: Date | null;
  last_order_at: Date | null;
  orders_count: number;
};

export function mapCompany(r: CompanyRow) {
  const status = !r.is_active ? "suspended" : r.activated_at ? "active" : "not_activated";
  return {
    id: r.id,
    companyName: r.company_name,
    ownerName: r.owner_name,
    phone: r.phone,
    email: r.email,
    governorate: r.city,
    status,
    contactId: r.contact_id,
    segment: r.segment,
    minimumOrderQuantity: r.minimum_order_quantity,
    salesUserId: r.assigned_sales_user_id,
    salesName: r.sales_name,
    membersCount: r.members_count,
    pendingJoin: r.pending_join,
    ordersCount: r.orders_count,
    lastOrderAt: r.last_order_at,
    lastActivityAt: r.last_activity_at,
    createdAt: r.created_at,
    health: customerHealth(r.balance, r.credit_limit, r.last_order_at ? new Date(r.last_order_at) : null),
  };
}

function where(filters: SQL[]): SQL {
  return filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
}

export async function queryCompanies(f: CompanyListQuery, opts: { all?: boolean } = {}) {
  const orderCol = sql.raw(SORT_SQL[f.sort]);
  const dir = sql.raw(f.dir === "asc" ? "ASC" : "DESC");
  const limit = opts.all ? sql`LIMIT 10000` : sql`LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`;
  const res = await db.execute<CompanyRow & { total: number }>(sql`
    SELECT t.*, count(*) OVER()::int AS total
    FROM (${BASE}) t
    ${where(companyFilters(f))}
    ORDER BY ${orderCol} ${dir} NULLS LAST, t.id DESC
    ${limit}
  `);
  const rows = res.rows as (CompanyRow & { total: number })[];
  return { items: rows.map(mapCompany), total: rows[0]?.total ?? 0 };
}

export async function loadCompanyRow(id: number) {
  const res = await db.execute<CompanyRow>(sql`SELECT t.* FROM (${BASE}) t WHERE t.id = ${id}`);
  const row = (res.rows as CompanyRow[])[0];
  return row ? mapCompany(row) : null;
}
