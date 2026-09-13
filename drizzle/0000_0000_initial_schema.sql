CREATE TABLE "inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"category" text DEFAULT 'raw_material' NOT NULL,
	"qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"reserved_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"min_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"unit" text,
	"requires_quality_check" boolean DEFAULT false NOT NULL,
	"supplier_id" integer,
	"lead_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "contact_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" numeric NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" numeric,
	"amount" numeric(12, 2) NOT NULL,
	"balance_after" numeric(12, 2) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer,
	"type" text DEFAULT 'customer' NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"phone" text,
	"email" text,
	"address" text,
	"balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"credit_limit" numeric(12, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"inventory_item_id" integer,
	"description" text NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"contact_id" integer,
	"created_by_id" integer,
	"channel" text DEFAULT 'direct' NOT NULL,
	"date" date NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"inventory_item_id" integer,
	"description" text NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"accepted_qty" numeric(12, 3),
	"rejected_qty" numeric(12, 3)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"contact_id" integer,
	"date" date NOT NULL,
	"expected_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"bom_recipe_id" integer,
	"product_name" text NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"stages" jsonb DEFAULT '[]',
	"start_date" date,
	"end_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "bom_recipe_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"inventory_item_id" integer,
	"material_name" text NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_code" text,
	"product_name" text NOT NULL,
	"description" text,
	"output_qty" numeric(12, 3) DEFAULT '1' NOT NULL,
	"unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_inspections" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_type" text,
	"reference_id" integer,
	"reference_name" text,
	"inspection_date" date NOT NULL,
	"inspector" text NOT NULL,
	"result" text DEFAULT 'pass' NOT NULL,
	"defect_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"inventory_item_id" integer NOT NULL,
	"movement_type" text NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"reference_type" text,
	"reference_id" integer,
	"unit_price" numeric(12, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description" text NOT NULL,
	"payment_method" text,
	"reference_type" text,
	"reference_id" integer,
	"is_voided" boolean DEFAULT false NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"date" date NOT NULL,
	"check_in" text,
	"check_out" text,
	"status" text DEFAULT 'present' NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_number" text,
	"name" text NOT NULL,
	"department" text NOT NULL,
	"position" text,
	"salary" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"hire_date" date,
	"phone" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_info" text,
	"ip_address" text,
	"is_new_device" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" integer,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "permission_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"action_key" text NOT NULL,
	"allowed" boolean NOT NULL,
	"reason" text,
	"expires_at" timestamp with time zone,
	"granted_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" integer
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "system_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"vault_password_hash" text,
	"vault_security_question" text,
	"vault_security_answer_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"reference_type" text,
	"reference_id" integer,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_number" text NOT NULL,
	"requested_by_id" integer NOT NULL,
	"requested_by_name" text NOT NULL,
	"product_name" text NOT NULL,
	"requested_qty" numeric(12, 3) NOT NULL,
	"unit" text DEFAULT 'وحدة' NOT NULL,
	"needed_by" date,
	"reason" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"warehouse_status" text DEFAULT 'pending' NOT NULL,
	"approved_qty" numeric(12, 3),
	"warehouse_comment" text,
	"warehouse_action_by_id" integer,
	"warehouse_action_by_name" text,
	"warehouse_action_at" timestamp with time zone,
	"director_status" text DEFAULT 'pending' NOT NULL,
	"director_comment" text,
	"director_action_by_id" integer,
	"director_action_by_name" text,
	"director_action_at" timestamp with time zone,
	"director_override_qty" numeric(12, 3),
	"status" text DEFAULT 'pending_warehouse' NOT NULL,
	"final_qty" numeric(12, 3),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_requests_request_number_unique" UNIQUE("request_number")
);
--> statement-breakpoint
CREATE TABLE "production_workflow_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"workflow_status" text DEFAULT 'new' NOT NULL,
	"sales_order_id" integer,
	"parent_workflow_order_id" integer,
	"root_sales_order_id" integer,
	"source_type" text,
	"sales_order_ref" text,
	"customer_name" text,
	"customer_phone" text,
	"customer_email" text,
	"order_source" text,
	"order_details" text,
"portal_customer_id" integer,
	"created_by_id" integer NOT NULL,
	"created_by_name" text NOT NULL,
	"bom_recipe_id" integer,
	"product_name" text NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"unit" text DEFAULT 'وحدة' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"needed_by" date,
	"notes" text,
	"supervisor_id" integer,
	"supervisor_name" text,
	"supervisor_accepted_at" timestamp with time zone,
	"supervisor_notes" text,
	"requested_materials" jsonb DEFAULT '[]',
	"material_request_id" integer,
	"materials_requested_at" timestamp with time zone,
	"warehouse_manager_id" integer,
	"warehouse_manager_name" text,
	"warehouse_decision" text,
	"warehouse_approved_qty" numeric(12, 3),
	"warehouse_comment" text,
	"warehouse_decided_at" timestamp with time zone,
	"assigned_engineer_id" integer,
	"assigned_engineer_name" text,
	"quality_controller_user_id" integer,
	"quality_controller_name" text,
	"team_assigned_at" timestamp with time zone,
	"production_line" text,
	"operational_status" text,
	"pending_reason" text,
	"received_by_user_id" integer,
	"received_by_name" text,
	"received_at" timestamp with time zone,
	"current_stage" text,
	"quality_status" text DEFAULT 'pending',
	"quality_notes" text,
	"quality_done_at" timestamp with time zone,
	"quality_reported_by_id" integer,
	"quality_reported_by_name" text,
	"delivery_type" text,
	"delivery_notes" text,
	"delivered_at" timestamp with time zone,
	"delivered_by_id" integer,
	"delivered_by_name" text,
	"delivery_initiated_by_id" integer,
	"delivery_initiated_by_name" text,
	"delivery_initiated_at" timestamp with time zone,
	"pending_delivery_inventory_item_id" integer,
	"pending_delivery_add_to_inventory" boolean DEFAULT false,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_workflow_orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "trash" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"record_id" integer NOT NULL,
	"label" text,
	"record_data" jsonb NOT NULL,
	"deleted_by_user_id" integer,
	"deleted_by_name" text,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restored_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quality_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_order_id" integer NOT NULL,
	"order_number" text NOT NULL,
	"production_line" text,
	"supervisor_id" integer,
	"supervisor_name" text,
	"quality_status" text NOT NULL,
	"quality_notes" text,
	"performance_rating" integer,
	"sample_size" integer,
	"sample_passed_count" integer,
	"sample_failed_count" integer,
	"defect_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recorded_by_id" integer NOT NULL,
	"recorded_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"company_name" text NOT NULL,
	"minimum_order_quantity" integer DEFAULT 1 NOT NULL,
	"contact_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_customers_phone_unique" UNIQUE("phone"),
	CONSTRAINT "portal_customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "portal_password_reset_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"portal_customer_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_by_id" integer,
	"resolved_by_name" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_order_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_ref" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"reply_message" text,
	"expected_delivery" date,
	"reject_reason" text,
	"sales_order_id" integer,
	"reviewed_by_id" integer NOT NULL,
	"reviewed_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_order_reviews_batch_ref_unique" UNIQUE("batch_ref")
);
--> statement-breakpoint
CREATE TABLE "approval_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_key" text NOT NULL,
	"min_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"approver_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"required_approvals" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_key" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" integer NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"requested_by" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_user_id" integer,
	"actor_name" text,
	"action_key" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" integer,
	"before_data" jsonb,
	"after_data" jsonb,
	"decision" text DEFAULT 'executed' NOT NULL,
	"reason" text,
	"delegation_id" integer,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" serial PRIMARY KEY NOT NULL,
	"grantor_user_id" integer NOT NULL,
	"delegate_user_id" integer NOT NULL,
	"action_key" text NOT NULL,
	"scope_type" text DEFAULT 'company' NOT NULL,
	"scope_id" text,
	"max_amount" numeric(14, 2),
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" integer
);
--> statement-breakpoint
CREATE TABLE "document_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" integer NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_reason" text NOT NULL,
	"changed_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_order_id" integer NOT NULL,
	"batch_number" text NOT NULL,
	"planned_qty" numeric(14, 3) NOT NULL,
	"produced_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"accepted_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"rework_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"scrap_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"stage" text DEFAULT 'manufacturing' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"scrap_reason" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_batches_batch_number_unique" UNIQUE("batch_number")
);
--> statement-breakpoint
CREATE TABLE "production_cost_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_order_id" integer NOT NULL,
	"batch_id" integer,
	"cost_type" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"quantity" numeric(14, 3),
	"unit_rate" numeric(14, 4),
	"source_type" text,
	"source_id" integer,
	"note" text,
"status" text DEFAULT 'approved' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"exception_type" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" integer NOT NULL,
	"title" text NOT NULL,
	"details" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" integer,
	"root_cause" text,
	"resolution" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" integer
);
--> statement-breakpoint
CREATE TABLE "fulfillment_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"sales_order_id" integer NOT NULL,
	"sales_order_item_id" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_id" integer,
	"inventory_item_id" integer,
	"quantity" numeric(14, 3) NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_allocations_item_source_unique" UNIQUE("sales_order_item_id","source_type","source_id")
);
--> statement-breakpoint
CREATE TABLE "operation_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_order_id" integer NOT NULL,
	"direction" text NOT NULL,
	"inventory_item_id" integer,
	"quantity" numeric(14, 3) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"prepared_by" integer NOT NULL,
	"received_by" integer,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"notes" text,
	CONSTRAINT "operation_transfers_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "purchase_requisitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"sales_order_id" integer,
	"workflow_order_id" integer,
	"inventory_item_id" integer,
	"material_name" text NOT NULL,
	"required_qty" numeric(14, 3) NOT NULL,
	"available_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"shortage_qty" numeric(14, 3) NOT NULL,
	"status" text DEFAULT 'pending_operations' NOT NULL,
	"reason" text NOT NULL,
	"confirmed_by" integer,
	"confirmed_at" timestamp with time zone,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requisitions_workflow_item_unique" UNIQUE("workflow_order_id","inventory_item_id","material_name")
);
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_order_id" integer NOT NULL,
	"internal_status" text NOT NULL,
	"customer_status" text,
	"actor_user_id" integer,
	"actor_name" text,
	"automatic" boolean DEFAULT false NOT NULL,
	"cause" text,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_bom_recipe_id_bom_recipes_id_fk" FOREIGN KEY ("bom_recipe_id") REFERENCES "public"."bom_recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_recipe_items" ADD CONSTRAINT "bom_recipe_items_recipe_id_bom_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."bom_recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_recipe_items" ADD CONSTRAINT "bom_recipe_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_sessions" ADD CONSTRAINT "login_sessions_user_id_system_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."system_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_sessions" ADD CONSTRAINT "login_sessions_revoked_by_system_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_user_id_system_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."system_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_granted_by_system_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_revoked_by_system_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_system_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."system_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_requests" ADD CONSTRAINT "production_requests_requested_by_id_system_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_requests" ADD CONSTRAINT "production_requests_warehouse_action_by_id_system_users_id_fk" FOREIGN KEY ("warehouse_action_by_id") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_requests" ADD CONSTRAINT "production_requests_director_action_by_id_system_users_id_fk" FOREIGN KEY ("director_action_by_id") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_workflow_orders" ADD CONSTRAINT "production_workflow_orders_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_workflow_orders" ADD CONSTRAINT "production_workflow_orders_root_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("root_sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_workflow_orders" ADD CONSTRAINT "production_workflow_orders_bom_recipe_id_bom_recipes_id_fk" FOREIGN KEY ("bom_recipe_id") REFERENCES "public"."bom_recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_workflow_orders" ADD CONSTRAINT "production_workflow_orders_portal_customer_id_fk" FOREIGN KEY ("portal_customer_id") REFERENCES "public"."portal_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_records" ADD CONSTRAINT "quality_records_workflow_order_id_production_workflow_orders_id_fk" FOREIGN KEY ("workflow_order_id") REFERENCES "public"."production_workflow_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_customers" ADD CONSTRAINT "portal_customers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_password_reset_requests" ADD CONSTRAINT "portal_password_reset_requests_portal_customer_id_portal_customers_id_fk" FOREIGN KEY ("portal_customer_id") REFERENCES "public"."portal_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_system_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_system_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."system_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_grantor_user_id_system_users_id_fk" FOREIGN KEY ("grantor_user_id") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_delegate_user_id_system_users_id_fk" FOREIGN KEY ("delegate_user_id") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_revoked_by_system_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_changed_by_system_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_workflow_order_id_production_workflow_orders_id_fk" FOREIGN KEY ("workflow_order_id") REFERENCES "public"."production_workflow_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_created_by_system_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_cost_entries" ADD CONSTRAINT "production_cost_entries_workflow_order_id_production_workflow_orders_id_fk" FOREIGN KEY ("workflow_order_id") REFERENCES "public"."production_workflow_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_cost_entries" ADD CONSTRAINT "production_cost_entries_batch_id_production_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."production_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_cost_entries" ADD CONSTRAINT "production_cost_entries_created_by_system_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_exceptions" ADD CONSTRAINT "production_exceptions_assigned_to_system_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_exceptions" ADD CONSTRAINT "production_exceptions_created_by_system_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_exceptions" ADD CONSTRAINT "production_exceptions_resolved_by_system_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."system_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_category_idx" ON "inventory_items" USING btree ("category");--> statement-breakpoint
CREATE INDEX "inventory_code_idx" ON "inventory_items" USING btree ("code");--> statement-breakpoint
CREATE INDEX "inventory_name_idx" ON "inventory_items" USING btree ("name");--> statement-breakpoint
CREATE INDEX "inventory_supplier_idx" ON "inventory_items" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "contact_ledger_contact_idx" ON "contact_ledger" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contacts_type_idx" ON "contacts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "contacts_name_idx" ON "contacts" USING btree ("name");--> statement-breakpoint
CREATE INDEX "sales_items_order_idx" ON "sales_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "sales_contact_idx" ON "sales_orders" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "sales_status_idx" ON "sales_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sales_date_idx" ON "sales_orders" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_created_at_idx" ON "sales_orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "purchases_items_order_idx" ON "purchase_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "purchases_contact_idx" ON "purchase_orders" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "purchases_status_idx" ON "purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "purchases_date_idx" ON "purchase_orders" USING btree ("date");--> statement-breakpoint
CREATE INDEX "purchases_created_at_idx" ON "purchase_orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "production_status_idx" ON "production_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "production_bom_recipe_idx" ON "production_orders" USING btree ("bom_recipe_id");--> statement-breakpoint
CREATE INDEX "quality_ref_idx" ON "quality_inspections" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "quality_result_idx" ON "quality_inspections" USING btree ("result");--> statement-breakpoint
CREATE INDEX "movements_item_idx" ON "stock_movements" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE INDEX "movements_type_idx" ON "stock_movements" USING btree ("movement_type");--> statement-breakpoint
CREATE INDEX "movements_ref_idx" ON "stock_movements" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "movements_created_at_idx" ON "stock_movements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "accounting_date_idx" ON "accounting_transactions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "accounting_type_idx" ON "accounting_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "accounting_voided_idx" ON "accounting_transactions" USING btree ("is_voided");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_employee_date_unique" ON "attendance_logs" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "attendance_date_idx" ON "attendance_logs" USING btree ("date");--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "employees_department_idx" ON "employees" USING btree ("department");--> statement-breakpoint
CREATE INDEX "login_sessions_user_idx" ON "login_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "permission_overrides_user_idx" ON "permission_overrides" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "permission_overrides_user_action_idx" ON "permission_overrides" USING btree ("user_id","action_key");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "prod_requests_status_idx" ON "production_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "prod_requests_user_idx" ON "production_requests" USING btree ("requested_by_id");--> statement-breakpoint
CREATE INDEX "prod_requests_created_at_idx" ON "production_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trash_table_name_idx" ON "trash" USING btree ("table_name");--> statement-breakpoint
CREATE INDEX "trash_deleted_at_idx" ON "trash" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "trash_restored_at_idx" ON "trash" USING btree ("restored_at");--> statement-breakpoint
CREATE INDEX "approval_policies_lookup_idx" ON "approval_policies" USING btree ("action_key","min_amount","active");--> statement-breakpoint
CREATE INDEX "approval_requests_resource_idx" ON "approval_requests" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "approval_requests_pending_idx" ON "approval_requests" USING btree ("status","action_key");--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "delegations_delegate_action_idx" ON "delegations" USING btree ("delegate_user_id","action_key");--> statement-breakpoint
CREATE INDEX "delegations_active_window_idx" ON "delegations" USING btree ("status","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "document_revisions_document_idx" ON "document_revisions" USING btree ("resource_type","resource_id","version");--> statement-breakpoint
CREATE INDEX "production_batches_order_idx" ON "production_batches" USING btree ("workflow_order_id","status");--> statement-breakpoint
CREATE INDEX "production_cost_entries_order_type_idx" ON "production_cost_entries" USING btree ("workflow_order_id","cost_type");--> statement-breakpoint
CREATE INDEX "production_exceptions_queue_idx" ON "production_exceptions" USING btree ("status","severity","created_at");--> statement-breakpoint
CREATE INDEX "production_exceptions_resource_idx" ON "production_exceptions" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "fulfillment_allocations_order_idx" ON "fulfillment_allocations" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "fulfillment_allocations_source_idx" ON "fulfillment_allocations" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "operation_transfers_workflow_idx" ON "operation_transfers" USING btree ("workflow_order_id","status");--> statement-breakpoint
CREATE INDEX "purchase_requisitions_workflow_idx" ON "purchase_requisitions" USING btree ("workflow_order_id","status");--> statement-breakpoint
CREATE INDEX "purchase_requisitions_item_idx" ON "purchase_requisitions" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE INDEX "workflow_events_workflow_idx" ON "workflow_events" USING btree ("workflow_order_id","created_at");