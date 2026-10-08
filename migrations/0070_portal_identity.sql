-- Plan 02: multi-user identity (company / user / member), roles, company codes,
-- settings registry and per-company audit. Idempotent. The company id stays equal
-- to the existing portal_customers.id (portal_customers is the company table for
-- now), so every existing foreign key keeps working.

CREATE TABLE IF NOT EXISTS "portal_users" (
  "id" serial PRIMARY KEY NOT NULL,
  "phone" text NOT NULL,
  "normalized_phone" text NOT NULL,
  "email" text,
  "normalized_email" text,
  "password_hash" text NOT NULL,
  "full_name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "must_change_password" boolean NOT NULL DEFAULT false,
  "activated_at" timestamptz,
  "last_login_at" timestamptz,
  "failed_login_attempts" integer NOT NULL DEFAULT 0,
  "locked_until" timestamptz,
  "locale" text NOT NULL DEFAULT 'ar',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "portal_users_status_check" CHECK ("status" IN ('active','disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_users_normalized_phone_unique" ON "portal_users" ("normalized_phone");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_users_normalized_email_unique" ON "portal_users" ("normalized_email") WHERE "normalized_email" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_roles" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer REFERENCES "portal_customers"("id") ON DELETE CASCADE,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "permissions" text[] NOT NULL DEFAULT '{}',
  "is_system" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_roles_company_key_unique" ON "portal_roles" ((COALESCE("company_id", 0)), "key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_members" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL REFERENCES "portal_customers"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "role_id" integer NOT NULL REFERENCES "portal_roles"("id"),
  "status" text NOT NULL DEFAULT 'active',
  "is_owner" boolean NOT NULL DEFAULT false,
  "limits" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "joined_via" text NOT NULL DEFAULT 'owner_created',
  "invited_by_member_id" integer,
  "approved_by_member_id" integer,
  "approved_by_staff_id" integer,
  "title" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_active_at" timestamptz,
  CONSTRAINT "portal_members_status_check" CHECK ("status" IN ('invited','pending_approval','active','suspended','removed')),
  CONSTRAINT "portal_members_joined_via_check" CHECK ("joined_via" IN ('owner_created','admin_created','company_code','invite','migration'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_members_company_user_unique" ON "portal_members" ("company_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_members_company_status_idx" ON "portal_members" ("company_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_members_user_idx" ON "portal_members" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_member_overrides" (
  "member_id" integer NOT NULL REFERENCES "portal_members"("id") ON DELETE CASCADE,
  "permission_key" text NOT NULL,
  "effect" text NOT NULL,
  PRIMARY KEY ("member_id", "permission_key"),
  CONSTRAINT "portal_member_overrides_effect_check" CHECK ("effect" IN ('allow','deny'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_company_codes" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL REFERENCES "portal_customers"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "expires_at" timestamptz,
  "max_uses" integer,
  "uses" integer NOT NULL DEFAULT 0,
  "created_by_member_id" integer,
  "created_by_staff_id" integer,
  "revoke_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  CONSTRAINT "portal_company_codes_status_check" CHECK ("status" IN ('active','revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_company_codes_code_unique" ON "portal_company_codes" ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_company_codes_one_active" ON "portal_company_codes" ("company_id") WHERE "status" = 'active';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "scope" text NOT NULL,
  "scope_id" integer,
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "updated_by" text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "portal_settings_scope_check" CHECK ("scope" IN ('global','company','member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_settings_scope_key_unique" ON "portal_settings" ("scope", (COALESCE("scope_id", 0)), "key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_audit_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL,
  "actor_member_id" integer,
  "actor_staff_user_id" integer,
  "actor_label" text NOT NULL,
  "action" text NOT NULL,
  "target_type" text,
  "target_id" text,
  "before" jsonb,
  "after" jsonb,
  "ip" text,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_audit_company_created_idx" ON "portal_audit_events" ("company_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_audit_actor_created_idx" ON "portal_audit_events" ("actor_member_id", "created_at" DESC);
--> statement-breakpoint
-- Nullable links to the new identity on the existing tables (expand only).
ALTER TABLE "portal_sessions"
  ADD COLUMN IF NOT EXISTS "user_id" integer,
  ADD COLUMN IF NOT EXISTS "member_id" integer,
  ADD COLUMN IF NOT EXISTS "company_id" integer;
--> statement-breakpoint
ALTER TABLE "production_workflow_orders"
  ADD COLUMN IF NOT EXISTS "submitted_by_member_id" integer,
  ADD COLUMN IF NOT EXISTS "created_by_kind" text;
--> statement-breakpoint
ALTER TABLE "portal_order_batches" ADD COLUMN IF NOT EXISTS "submitted_by_member_id" integer;
--> statement-breakpoint
ALTER TABLE "portal_cart_items" ADD COLUMN IF NOT EXISTS "member_id" integer;
--> statement-breakpoint
ALTER TABLE "portal_wishlist_items" ADD COLUMN IF NOT EXISTS "member_id" integer;
--> statement-breakpoint
ALTER TABLE "portal_notifications" ADD COLUMN IF NOT EXISTS "member_id" integer;
--> statement-breakpoint
ALTER TABLE "portal_password_reset_requests" ADD COLUMN IF NOT EXISTS "user_id" integer;
--> statement-breakpoint
ALTER TABLE "portal_activation_tokens" ADD COLUMN IF NOT EXISTS "user_id" integer;
--> statement-breakpoint
ALTER TABLE "portal_otp_codes" ADD COLUMN IF NOT EXISTS "user_id" integer;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "sender_member_id" integer;
--> statement-breakpoint
ALTER TABLE "production_workflow_orders" ADD COLUMN IF NOT EXISTS "cancelled_by_member_id" integer;
--> statement-breakpoint
-- Cart / wishlist become per member (cart.scope = member) or per company
-- (member_id NULL). The old "one row per company+recipe" unique indexes are
-- relaxed (not data-destructive) and replaced by member-aware ones.
DROP INDEX IF EXISTS "portal_cart_items_customer_recipe_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_cart_items_member_recipe_unique" ON "portal_cart_items" ("portal_customer_id", (COALESCE("member_id", 0)), "bom_recipe_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "portal_wishlist_items_customer_recipe_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "portal_wishlist_items_member_recipe_unique" ON "portal_wishlist_items" ("portal_customer_id", (COALESCE("member_id", 0)), "bom_recipe_id");
--> statement-breakpoint
-- System role templates (company_id NULL). Companies copy and edit them.
INSERT INTO "portal_roles" ("company_id", "key", "name", "description", "permissions", "is_system", "sort_order") VALUES
 (NULL, 'owner', 'رئيس الشركة', 'كل الصلاحيات. مينفعش يتعدّل.', ARRAY[
   'catalog.view','prices.view_reference','cart.use','orders.create','orders.view_own','orders.view_company',
   'orders.cancel_own','orders.cancel_company','inquiries.create','inquiries.view_company','chat.use','chat.view_company',
   'team.view','team.invite','team.manage','team.approve_join','company.edit_profile','company.manage_code',
   'company.settings','audit.view','notifications.company'], true, 1),
 (NULL, 'manager', 'مدير', 'يدير الفريق ويشوف كل أوردرات الشركة.', ARRAY[
   'catalog.view','prices.view_reference','cart.use','orders.create','orders.view_own','orders.view_company',
   'orders.cancel_own','orders.cancel_company','inquiries.create','inquiries.view_company','chat.use','chat.view_company',
   'team.view','team.invite','team.manage','team.approve_join','audit.view','notifications.company'], true, 2),
 (NULL, 'buyer', 'مشتري', 'يطلب ويشوف أوردراته.', ARRAY[
   'catalog.view','prices.view_reference','cart.use','orders.create','orders.view_own','orders.cancel_own',
   'inquiries.create','chat.use'], true, 3),
 (NULL, 'viewer', 'مطّلع', 'يتصفح الكتالوج ويشوف بس.', ARRAY['catalog.view','orders.view_own'], true, 4)
ON CONFLICT DO NOTHING;
