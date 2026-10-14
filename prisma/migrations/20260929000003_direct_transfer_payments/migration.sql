-- CreateEnum
CREATE TYPE "TransferMode" AS ENUM ('LEGACY_PARTS', 'ACCOUNT_ONLY');

-- AlterTable
ALTER TABLE "transfers" ADD COLUMN "mode" "TransferMode" NOT NULL DEFAULT 'LEGACY_PARTS';

-- AlterTable
ALTER TABLE "transfers" ADD COLUMN "source_account_id" UUID;

-- AlterTable
ALTER TABLE "transfers" ADD COLUMN "destination_account_id" UUID;

-- CreateTable
CREATE TABLE "plan_payments" (
    "id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "occurrence_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plan_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfers_budget_id_source_account_id_idx" ON "transfers"("budget_id", "source_account_id");

-- CreateIndex
CREATE INDEX "transfers_budget_id_destination_account_id_idx" ON "transfers"("budget_id", "destination_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_payments_budget_id_transaction_id_key" ON "plan_payments"("budget_id", "transaction_id");

-- CreateIndex
CREATE INDEX "plan_payments_budget_id_occurrence_id_idx" ON "plan_payments"("budget_id", "occurrence_id");

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_account_id_budget_id_fkey" FOREIGN KEY ("source_account_id", "budget_id") REFERENCES "accounts"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_account_id_budget_id_fkey" FOREIGN KEY ("destination_account_id", "budget_id") REFERENCES "accounts"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_payments" ADD CONSTRAINT "plan_payments_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_payments" ADD CONSTRAINT "plan_payments_occurrence_id_budget_id_fkey" FOREIGN KEY ("occurrence_id", "budget_id") REFERENCES "plan_occurrences"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_payments" ADD CONSTRAINT "plan_payments_transaction_id_budget_id_fkey" FOREIGN KEY ("transaction_id", "budget_id") REFERENCES "transactions"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_mode_accounts_shape_check" CHECK (
  ("mode" = 'ACCOUNT_ONLY' AND "source_account_id" IS NOT NULL AND "destination_account_id" IS NOT NULL AND "source_account_id" <> "destination_account_id")
  OR ("mode" = 'LEGACY_PARTS' AND "source_account_id" IS NULL AND "destination_account_id" IS NULL)
);
