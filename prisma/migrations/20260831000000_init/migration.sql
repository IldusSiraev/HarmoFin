-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'LOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "SessionRevokeReason" AS ENUM ('LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'ALL_SESSIONS_REVOKED', 'ROTATED', 'ADMIN_REVOKED');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkspaceMembershipRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(512) NOT NULL,
    "display_name" VARCHAR(120),
    "email_verified_at" TIMESTAMPTZ(3),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" "SessionRevokeReason",
    "user_agent" VARCHAR(512),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_memberships" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WorkspaceMembershipRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspace_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "primary_currency" CHAR(3) NOT NULL DEFAULT 'RUB',
    "cycle_start_day" SMALLINT NOT NULL DEFAULT 10,
    "period_boundary_offset" SMALLINT NOT NULL DEFAULT 15,
    "allow_negative_balance" BOOLEAN NOT NULL DEFAULT false,
    "status" "BudgetStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "workspace_id" UUID,
    "budget_id" UUID,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "source" VARCHAR(32) NOT NULL,
    "request_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_csrf_token_hash_key" ON "sessions"("csrf_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idle_expires_at_idx" ON "sessions"("user_id", "revoked_at", "idle_expires_at");

-- CreateIndex
CREATE INDEX "sessions_user_id_absolute_expires_at_idx" ON "sessions"("user_id", "absolute_expires_at");

-- CreateIndex
CREATE INDEX "workspaces_owner_id_status_idx" ON "workspaces"("owner_id", "status");

-- CreateIndex
CREATE INDEX "workspace_memberships_user_id_is_active_idx" ON "workspace_memberships"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "workspace_memberships_workspace_id_is_active_idx" ON "workspace_memberships"("workspace_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_memberships_workspace_id_user_id_key" ON "workspace_memberships"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "budgets_workspace_id_status_idx" ON "budgets"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_tokens_token_hash_key" ON "recovery_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "recovery_tokens_user_id_consumed_at_expires_at_idx" ON "recovery_tokens"("user_id", "consumed_at", "expires_at");

-- CreateIndex
CREATE INDEX "audit_events_workspace_id_created_at_idx" ON "audit_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_budget_id_created_at_idx" ON "audit_events"("budget_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_user_id_created_at_idx" ON "audit_events"("actor_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_tokens" ADD CONSTRAINT "recovery_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddConstraints
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));
ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_name_not_blank_check" CHECK (length(btrim("name")) > 0);
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_name_not_blank_check" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "budgets_primary_currency_check" CHECK ("primary_currency" = 'RUB'),
  ADD CONSTRAINT "budgets_cycle_start_day_check" CHECK ("cycle_start_day" BETWEEN 1 AND 28),
  ADD CONSTRAINT "budgets_period_boundary_offset_check" CHECK ("period_boundary_offset" BETWEEN 1 AND 27);
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_expiry_order_check"
  CHECK ("idle_expires_at" > "created_at" AND "absolute_expires_at" >= "idle_expires_at");
ALTER TABLE "recovery_tokens"
  ADD CONSTRAINT "recovery_tokens_expiry_check" CHECK ("expires_at" > "created_at");
