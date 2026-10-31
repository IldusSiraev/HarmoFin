-- Email notifications: per-user channel settings, delivery outbox, email verification tokens.
-- Additive: new enums, new tables, two new worker job types; no backfill.

-- AlterEnum
ALTER TYPE "WorkerJobType" ADD VALUE IF NOT EXISTS 'DELIVER_NOTIFICATIONS';
ALTER TYPE "WorkerJobType" ADD VALUE IF NOT EXISTS 'BUILD_EMAIL_DIGESTS';

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');
CREATE TYPE "DigestFrequency" AS ENUM ('OFF', 'DAILY', 'WEEKLY');
CREATE TYPE "DeliveryKind" AS ENUM ('URGENT', 'DIGEST');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "notification_channel_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "urgent_enabled" BOOLEAN NOT NULL DEFAULT true,
    "digest_frequency" "DigestFrequency" NOT NULL DEFAULT 'DAILY',
    "include_amounts" BOOLEAN NOT NULL DEFAULT false,
    "amounts_consent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "notification_channel_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "kind" "DeliveryKind" NOT NULL,
    "notification_id" UUID,
    "digest_period_start" TIMESTAMPTZ(3),
    "digest_period_end" TIMESTAMPTZ(3),
    "dedupe_key" VARCHAR(255) NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(200),
    "unsubscribe_token_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_channel_settings_user_id_channel_key" ON "notification_channel_settings"("user_id", "channel");
CREATE INDEX "notification_channel_settings_channel_enabled_idx" ON "notification_channel_settings"("channel", "enabled");
CREATE UNIQUE INDEX "notification_deliveries_unsubscribe_token_hash_key" ON "notification_deliveries"("unsubscribe_token_hash");
CREATE UNIQUE INDEX "notification_deliveries_budget_id_user_id_channel_dedupe_ke_key" ON "notification_deliveries"("budget_id", "user_id", "channel", "dedupe_key");
CREATE INDEX "notification_deliveries_status_next_attempt_at_idx" ON "notification_deliveries"("status", "next_attempt_at");
CREATE INDEX "notification_deliveries_user_id_budget_id_kind_digest_perio_idx" ON "notification_deliveries"("user_id", "budget_id", "kind", "digest_period_end");
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");
CREATE INDEX "email_verification_tokens_user_id_consumed_at_expires_at_idx" ON "email_verification_tokens"("user_id", "consumed_at", "expires_at");

-- AddForeignKey
ALTER TABLE "notification_channel_settings" ADD CONSTRAINT "notification_channel_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_budget_id_workspace_id_fkey" FOREIGN KEY ("budget_id", "workspace_id") REFERENCES "budgets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
