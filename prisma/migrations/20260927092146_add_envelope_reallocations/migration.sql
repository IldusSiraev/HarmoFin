-- CreateEnum
CREATE TYPE "EnvelopeReallocationStatus" AS ENUM ('CONFIRMED', 'DELETED');

-- DropForeignKey
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_income_allocation_source_category_budget_fkey";

-- DropForeignKey
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_income_allocation_target_envelope_budget_fkey";

-- CreateTable
CREATE TABLE "envelope_reallocations" (
    "id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "status" "EnvelopeReallocationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "source_envelope_id" UUID NOT NULL,
    "destination_envelope_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
    "scale" SMALLINT NOT NULL DEFAULT 2,
    "occurred_on" DATE NOT NULL,
    "comment" VARCHAR(500),
    "deleted_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "envelope_reallocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "envelope_reallocations_budget_id_source_envelope_id_idx" ON "envelope_reallocations"("budget_id", "source_envelope_id");

-- CreateIndex
CREATE INDEX "envelope_reallocations_budget_id_destination_envelope_id_idx" ON "envelope_reallocations"("budget_id", "destination_envelope_id");

-- CreateIndex
CREATE INDEX "envelope_reallocations_budget_id_occurred_on_idx" ON "envelope_reallocations"("budget_id", "occurred_on");

-- CreateIndex
CREATE UNIQUE INDEX "envelope_reallocations_id_budget_id_key" ON "envelope_reallocations"("id", "budget_id");

-- RenameForeignKey
ALTER TABLE "categories" RENAME CONSTRAINT "categories_parent_budget_fkey" TO "categories_parent_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "income_allocations" RENAME CONSTRAINT "income_allocations_account_budget_fkey" TO "income_allocations_account_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "income_allocations" RENAME CONSTRAINT "income_allocations_envelope_budget_fkey" TO "income_allocations_envelope_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "income_allocations" RENAME CONSTRAINT "income_allocations_income_transaction_budget_fkey" TO "income_allocations_income_transaction_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "notifications" RENAME CONSTRAINT "notifications_budget_workspace_fkey" TO "notifications_budget_id_workspace_id_fkey";

-- RenameForeignKey
ALTER TABLE "notifications" RENAME CONSTRAINT "notifications_occurrence_budget_fkey" TO "notifications_occurrence_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "plan_occurrences" RENAME CONSTRAINT "plan_occurrences_account_budget_fkey" TO "plan_occurrences_account_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "plan_occurrences" RENAME CONSTRAINT "plan_occurrences_budget_workspace_fkey" TO "plan_occurrences_budget_id_workspace_id_fkey";

-- RenameForeignKey
ALTER TABLE "plan_occurrences" RENAME CONSTRAINT "plan_occurrences_category_budget_fkey" TO "plan_occurrences_category_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "plan_occurrences" RENAME CONSTRAINT "plan_occurrences_envelope_budget_fkey" TO "plan_occurrences_envelope_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "plan_occurrences" RENAME CONSTRAINT "plan_occurrences_plan_budget_fkey" TO "plan_occurrences_plan_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "plan_occurrences" RENAME CONSTRAINT "plan_occurrences_transaction_budget_fkey" TO "plan_occurrences_transaction_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "regular_plans" RENAME CONSTRAINT "regular_plans_account_budget_fkey" TO "regular_plans_account_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "regular_plans" RENAME CONSTRAINT "regular_plans_budget_workspace_fkey" TO "regular_plans_budget_id_workspace_id_fkey";

-- RenameForeignKey
ALTER TABLE "regular_plans" RENAME CONSTRAINT "regular_plans_category_budget_fkey" TO "regular_plans_category_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "regular_plans" RENAME CONSTRAINT "regular_plans_envelope_budget_fkey" TO "regular_plans_envelope_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "transactions" RENAME CONSTRAINT "transactions_account_budget_fkey" TO "transactions_account_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "transactions" RENAME CONSTRAINT "transactions_category_budget_fkey" TO "transactions_category_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "transactions" RENAME CONSTRAINT "transactions_envelope_budget_fkey" TO "transactions_envelope_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "transfer_parts" RENAME CONSTRAINT "transfer_parts_destination_account_budget_fkey" TO "transfer_parts_destination_account_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "transfer_parts" RENAME CONSTRAINT "transfer_parts_destination_envelope_budget_fkey" TO "transfer_parts_destination_envelope_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "transfer_parts" RENAME CONSTRAINT "transfer_parts_source_account_budget_fkey" TO "transfer_parts_source_account_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "transfer_parts" RENAME CONSTRAINT "transfer_parts_source_envelope_budget_fkey" TO "transfer_parts_source_envelope_id_budget_id_fkey";

-- RenameForeignKey
ALTER TABLE "transfer_parts" RENAME CONSTRAINT "transfer_parts_transfer_budget_fkey" TO "transfer_parts_transfer_id_budget_id_fkey";

-- AddForeignKey
ALTER TABLE "envelope_reallocations" ADD CONSTRAINT "envelope_reallocations_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envelope_reallocations" ADD CONSTRAINT "envelope_reallocations_source_envelope_id_budget_id_fkey" FOREIGN KEY ("source_envelope_id", "budget_id") REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envelope_reallocations" ADD CONSTRAINT "envelope_reallocations_destination_envelope_id_budget_id_fkey" FOREIGN KEY ("destination_envelope_id", "budget_id") REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "categories_budget_type_archived_idx" RENAME TO "categories_budget_id_category_type_archived_at_idx";

-- RenameIndex
ALTER INDEX "idempotency_records_budget_actor_key_key" RENAME TO "idempotency_records_budget_id_actor_user_id_key_key";

-- RenameIndex
ALTER INDEX "notifications_budget_user_notification_key_key" RENAME TO "notifications_budget_id_user_id_notification_key_key";
