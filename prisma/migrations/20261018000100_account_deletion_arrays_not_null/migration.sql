-- Additive follow-up: the first migration is already applied, so align
-- the array columns with the Prisma model (non-optional String[]) here
-- instead of editing the applied migration. Table is new and empty.
ALTER TABLE "account_deletions" ALTER COLUMN "archived_workspace_ids" SET NOT NULL;
ALTER TABLE "account_deletions" ALTER COLUMN "archived_budget_ids" SET NOT NULL;
ALTER TABLE "account_deletions" ALTER COLUMN "deactivated_membership_ids" SET NOT NULL;
