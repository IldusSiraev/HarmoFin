CREATE TYPE "RegularPlanType" AS ENUM ('INCOME', 'EXPENSE', 'SAVINGS');
CREATE TYPE "PlanRecurrence" AS ENUM ('ONE_TIME', 'MONTHLY', 'EVERY_N_MONTHS', 'YEARLY');
CREATE TYPE "PlanOccurrenceStatus" AS ENUM ('PENDING', 'DUE', 'SKIPPED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "PlanOccurrenceCancellationReason" AS ENUM (
  'PLAN_CHANGED',
  'PLAN_DISABLED',
  'PLAN_DELETED'
);
CREATE TYPE "WorkerJobType" AS ENUM (
  'MATERIALIZE_PLAN_OCCURRENCES',
  'EVALUATE_BUDGET_NOTIFICATIONS'
);
CREATE TYPE "WorkerJobStatus" AS ENUM ('PENDING', 'RUNNING', 'FAILED');
CREATE TYPE "NotificationType" AS ENUM (
  'PLAN_UPCOMING',
  'PLAN_TODAY',
  'PLAN_OVERDUE',
  'UNALLOCATED_INCOME',
  'NEGATIVE_ACCOUNT',
  'NEGATIVE_ENVELOPE',
  'INSUFFICIENT_MANDATORY_OBLIGATIONS'
);

ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_id_workspace_id_key" UNIQUE ("id", "workspace_id");

CREATE TABLE "regular_plans" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "plan_type" "RegularPlanType" NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
  "scale" SMALLINT NOT NULL DEFAULT 2,
  "anchor_on" DATE NOT NULL,
  "start_on" DATE NOT NULL,
  "end_on" DATE,
  "recurrence" "PlanRecurrence" NOT NULL,
  "interval_months" SMALLINT,
  "account_id" UUID,
  "category_id" UUID,
  "envelope_id" UUID,
  "comment" VARCHAR(500),
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "disabled_at" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3),
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "regular_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "regular_plans_id_budget_id_key" UNIQUE ("id", "budget_id"),
  CONSTRAINT "regular_plans_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "regular_plans_budget_workspace_fkey"
    FOREIGN KEY ("budget_id", "workspace_id") REFERENCES "budgets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "regular_plans_account_budget_fkey"
    FOREIGN KEY ("account_id", "budget_id") REFERENCES "accounts"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "regular_plans_category_budget_fkey"
    FOREIGN KEY ("category_id", "budget_id") REFERENCES "categories"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "regular_plans_envelope_budget_fkey"
    FOREIGN KEY ("envelope_id", "budget_id") REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "regular_plans_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "regular_plans_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "regular_plans_amount_minor_positive_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "regular_plans_currency_check" CHECK ("currency" = 'RUB'),
  CONSTRAINT "regular_plans_scale_check" CHECK ("scale" = 2),
  CONSTRAINT "regular_plans_date_range_check" CHECK ("end_on" IS NULL OR "end_on" >= "start_on"),
  CONSTRAINT "regular_plans_interval_months_check" CHECK (
    ("recurrence" = 'EVERY_N_MONTHS' AND "interval_months" BETWEEN 2 AND 120)
    OR ("recurrence" <> 'EVERY_N_MONTHS' AND "interval_months" IS NULL)
  )
);

CREATE TABLE "plan_occurrences" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "scheduled_on" DATE NOT NULL,
  "plan_name" VARCHAR(120) NOT NULL,
  "plan_type" "RegularPlanType" NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
  "scale" SMALLINT NOT NULL DEFAULT 2,
  "account_id" UUID,
  "category_id" UUID,
  "envelope_id" UUID,
  "comment" VARCHAR(500),
  "status" "PlanOccurrenceStatus" NOT NULL DEFAULT 'PENDING',
  "transaction_id" UUID,
  "skipped_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "cancellation_reason" "PlanOccurrenceCancellationReason",
  "acted_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "plan_occurrences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plan_occurrences_id_budget_id_key" UNIQUE ("id", "budget_id"),
  CONSTRAINT "plan_occurrences_transaction_id_budget_id_key" UNIQUE ("transaction_id", "budget_id"),
  CONSTRAINT "plan_occurrences_plan_id_scheduled_on_key" UNIQUE ("plan_id", "scheduled_on"),
  CONSTRAINT "plan_occurrences_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plan_occurrences_budget_workspace_fkey"
    FOREIGN KEY ("budget_id", "workspace_id") REFERENCES "budgets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plan_occurrences_plan_budget_fkey"
    FOREIGN KEY ("plan_id", "budget_id") REFERENCES "regular_plans"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plan_occurrences_account_budget_fkey"
    FOREIGN KEY ("account_id", "budget_id") REFERENCES "accounts"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plan_occurrences_category_budget_fkey"
    FOREIGN KEY ("category_id", "budget_id") REFERENCES "categories"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plan_occurrences_envelope_budget_fkey"
    FOREIGN KEY ("envelope_id", "budget_id") REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plan_occurrences_transaction_budget_fkey"
    FOREIGN KEY ("transaction_id", "budget_id") REFERENCES "transactions"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plan_occurrences_acted_by_user_id_fkey"
    FOREIGN KEY ("acted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plan_occurrences_amount_minor_positive_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "plan_occurrences_currency_check" CHECK ("currency" = 'RUB'),
  CONSTRAINT "plan_occurrences_scale_check" CHECK ("scale" = 2),
  CONSTRAINT "plan_occurrences_lifecycle_check" CHECK (
    ("status" = 'SKIPPED') = ("skipped_at" IS NOT NULL)
    AND ("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)
    AND ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
    AND (("status" = 'CANCELLED') = ("cancellation_reason" IS NOT NULL))
  )
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "notification_type" "NotificationType" NOT NULL,
  "occurrence_id" UUID,
  "related_entity_type" VARCHAR(64),
  "related_entity_id" UUID,
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(1000) NOT NULL,
  "action_path" VARCHAR(512),
  "notification_key" VARCHAR(255) NOT NULL,
  "read_at" TIMESTAMPTZ(3),
  "resolved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_budget_user_notification_key_key" UNIQUE ("budget_id", "user_id", "notification_key"),
  CONSTRAINT "notifications_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notifications_budget_workspace_fkey"
    FOREIGN KEY ("budget_id", "workspace_id") REFERENCES "budgets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notifications_occurrence_budget_fkey"
    FOREIGN KEY ("occurrence_id", "budget_id") REFERENCES "plan_occurrences"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notifications_action_path_check"
    CHECK ("action_path" IS NULL OR "action_path" = '/app' OR "action_path" LIKE '/app/%')
);

CREATE TABLE "worker_jobs" (
  "id" UUID NOT NULL,
  "job_type" "WorkerJobType" NOT NULL,
  "payload" JSONB NOT NULL,
  "job_key" VARCHAR(128) NOT NULL,
  "status" "WorkerJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "run_at" TIMESTAMPTZ(3) NOT NULL,
  "locked_at" TIMESTAMPTZ(3),
  "lease_expires_at" TIMESTAMPTZ(3),
  "last_run_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "last_error" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "worker_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "worker_jobs_job_key_key" UNIQUE ("job_key"),
  CONSTRAINT "worker_jobs_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "worker_jobs_running_lease_check" CHECK (
    "status" <> 'RUNNING' OR ("locked_at" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
  )
);

CREATE INDEX "regular_plans_budget_id_is_active_deleted_at_idx"
  ON "regular_plans" ("budget_id", "is_active", "deleted_at");
CREATE INDEX "regular_plans_budget_id_start_on_end_on_idx"
  ON "regular_plans" ("budget_id", "start_on", "end_on");
CREATE INDEX "plan_occurrences_budget_id_status_scheduled_on_idx"
  ON "plan_occurrences" ("budget_id", "status", "scheduled_on");
CREATE INDEX "plan_occurrences_plan_id_scheduled_on_idx"
  ON "plan_occurrences" ("plan_id", "scheduled_on");
CREATE INDEX "notifications_budget_id_user_id_read_at_created_at_idx"
  ON "notifications" ("budget_id", "user_id", "read_at", "created_at");
CREATE INDEX "notifications_budget_id_occurrence_id_notification_type_idx"
  ON "notifications" ("budget_id", "occurrence_id", "notification_type");
CREATE UNIQUE INDEX "notifications_unresolved_state_warning_key"
  ON "notifications" (
    "budget_id", "user_id", "notification_type", "related_entity_type", "related_entity_id"
  )
  WHERE "resolved_at" IS NULL
    AND "occurrence_id" IS NULL
    AND "related_entity_type" IS NOT NULL
    AND "related_entity_id" IS NOT NULL;
CREATE INDEX "worker_jobs_status_run_at_idx"
  ON "worker_jobs" ("status", "run_at");
CREATE INDEX "worker_jobs_status_lease_expires_at_idx"
  ON "worker_jobs" ("status", "lease_expires_at");
