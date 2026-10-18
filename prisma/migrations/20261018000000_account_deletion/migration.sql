-- Additive only: new enum values and a new table.
ALTER TYPE "UserStatus" ADD VALUE 'PENDING_DELETION';
ALTER TYPE "SessionRevokeReason" ADD VALUE 'ACCOUNT_DELETED';
ALTER TYPE "WorkerJobType" ADD VALUE 'PURGE_DELETED_ACCOUNTS';

CREATE TABLE "account_deletions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "purge_after" TIMESTAMPTZ(3) NOT NULL,
    "restore_token_hash" CHAR(64) NOT NULL,
    "archived_workspace_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "archived_budget_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "deactivated_membership_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "restored_at" TIMESTAMPTZ(3),
    "purged_at" TIMESTAMPTZ(3),

    CONSTRAINT "account_deletions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_deletions_restore_token_hash_key" ON "account_deletions"("restore_token_hash");
CREATE INDEX "account_deletions_purged_at_restored_at_purge_after_idx" ON "account_deletions"("purged_at", "restored_at", "purge_after");
CREATE INDEX "account_deletions_user_id_idx" ON "account_deletions"("user_id");
