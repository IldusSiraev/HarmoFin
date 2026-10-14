-- CreateEnum
CREATE TYPE "EnvelopeAssignmentType" AS ENUM ('INCOME', 'OPENING', 'FREE');

-- CreateEnum
CREATE TYPE "EnvelopeLedgerStatus" AS ENUM ('CONFIRMED', 'DELETED');

-- CreateTable
CREATE TABLE "envelope_assignments" (
    "id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "envelope_id" UUID NOT NULL,
    "type" "EnvelopeAssignmentType" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "effective_on" DATE NOT NULL,
    "period_id" UUID,
    "source_income_transaction_id" UUID,
    "status" "EnvelopeLedgerStatus" NOT NULL DEFAULT 'CONFIRMED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "envelope_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "envelope_movements" (
    "id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "source_envelope_id" UUID NOT NULL,
    "source_period_id" UUID,
    "destination_envelope_id" UUID,
    "destination_period_id" UUID,
    "amount_minor" BIGINT NOT NULL,
    "effective_on" DATE NOT NULL,
    "status" "EnvelopeLedgerStatus" NOT NULL DEFAULT 'CONFIRMED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "envelope_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "envelope_assignments_id_budget_id_key" ON "envelope_assignments"("id", "budget_id");

-- CreateIndex
CREATE INDEX "envelope_assignments_budget_id_envelope_id_effective_on_idx" ON "envelope_assignments"("budget_id", "envelope_id", "effective_on");

-- CreateIndex
CREATE INDEX "envelope_assignments_budget_id_status_effective_on_idx" ON "envelope_assignments"("budget_id", "status", "effective_on");

-- CreateIndex
CREATE INDEX "envelope_assignments_budget_id_period_id_idx" ON "envelope_assignments"("budget_id", "period_id");

-- CreateIndex
CREATE INDEX "envelope_assignments_budget_id_source_income_transaction_id_idx" ON "envelope_assignments"("budget_id", "source_income_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "envelope_movements_id_budget_id_key" ON "envelope_movements"("id", "budget_id");

-- CreateIndex
CREATE INDEX "envelope_movements_budget_id_source_envelope_id_effective_o_idx" ON "envelope_movements"("budget_id", "source_envelope_id", "effective_on");

-- CreateIndex
CREATE INDEX "envelope_movements_budget_id_destination_envelope_id_effect_idx" ON "envelope_movements"("budget_id", "destination_envelope_id", "effective_on");

-- CreateIndex
CREATE INDEX "envelope_movements_budget_id_source_period_id_idx" ON "envelope_movements"("budget_id", "source_period_id");

-- CreateIndex
CREATE INDEX "envelope_movements_budget_id_destination_period_id_idx" ON "envelope_movements"("budget_id", "destination_period_id");

-- CreateIndex
CREATE INDEX "envelope_movements_budget_id_status_effective_on_idx" ON "envelope_movements"("budget_id", "status", "effective_on");

-- AddForeignKey
ALTER TABLE "envelope_assignments" ADD CONSTRAINT "envelope_assignments_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envelope_assignments" ADD CONSTRAINT "envelope_assignments_envelope_id_budget_id_fkey" FOREIGN KEY ("envelope_id", "budget_id") REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envelope_assignments" ADD CONSTRAINT "envelope_assignments_period_id_budget_id_envelope_id_fkey" FOREIGN KEY ("period_id", "budget_id", "envelope_id") REFERENCES "envelope_periods"("id", "budget_id", "envelope_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envelope_assignments" ADD CONSTRAINT "envelope_assignments_source_income_transaction_id_budget_i_fkey" FOREIGN KEY ("source_income_transaction_id", "budget_id") REFERENCES "transactions"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envelope_movements" ADD CONSTRAINT "envelope_movements_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envelope_movements" ADD CONSTRAINT "envelope_movements_source_envelope_id_budget_id_fkey" FOREIGN KEY ("source_envelope_id", "budget_id") REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envelope_movements" ADD CONSTRAINT "envelope_movements_source_period_id_budget_id_source_envel_fkey" FOREIGN KEY ("source_period_id", "budget_id", "source_envelope_id") REFERENCES "envelope_periods"("id", "budget_id", "envelope_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envelope_movements" ADD CONSTRAINT "envelope_movements_destination_envelope_id_budget_id_fkey" FOREIGN KEY ("destination_envelope_id", "budget_id") REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envelope_movements" ADD CONSTRAINT "envelope_movements_destination_period_id_budget_id_destina_fkey" FOREIGN KEY ("destination_period_id", "budget_id", "destination_envelope_id") REFERENCES "envelope_periods"("id", "budget_id", "envelope_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "envelope_assignments" ADD CONSTRAINT "envelope_assignments_amount_positive_check" CHECK ("amount_minor" > 0);

-- AlterTable
ALTER TABLE "envelope_movements" ADD CONSTRAINT "envelope_movements_amount_positive_check" CHECK ("amount_minor" > 0);

-- AlterTable
ALTER TABLE "envelope_assignments" ADD CONSTRAINT "envelope_assignments_source_shape_check" CHECK ((("type" = 'INCOME' AND "source_income_transaction_id" IS NOT NULL) OR ("type" <> 'INCOME' AND "source_income_transaction_id" IS NULL)));

-- AlterTable
ALTER TABLE "envelope_movements" ADD CONSTRAINT "envelope_movements_destination_null_together_check" CHECK (("destination_envelope_id" IS NULL) = ("destination_period_id" IS NULL));
