-- CreateEnum
CREATE TYPE "TargetStatus" AS ENUM ('UNSET', 'DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "FundingRuleType" AS ENUM ('MANUAL', 'SUM_OF_PLANS', 'FIXED_PER_PERIOD', 'SUGGESTED_FIXED', 'PERCENT_OF_INCOME');

-- CreateTable
CREATE TABLE "envelope_periods" (
    "id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "envelope_id" UUID NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "target_minor" BIGINT,
    "target_status" "TargetStatus" NOT NULL DEFAULT 'UNSET',
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "envelope_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "envelope_funding_rules" (
    "id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "envelope_id" UUID NOT NULL,
    "type" "FundingRuleType" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "fixed_minor" BIGINT,
    "percent_basis_points" INTEGER,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "envelope_funding_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_cycle_revisions" (
    "id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "effective_on" DATE NOT NULL,
    "cycle_start_day" SMALLINT NOT NULL,
    "period_boundary_offset" INTEGER NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "budget_cycle_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "envelope_periods_budget_id_starts_on_ends_on_idx" ON "envelope_periods"("budget_id", "starts_on", "ends_on");

-- CreateIndex
CREATE UNIQUE INDEX "envelope_periods_id_budget_id_key" ON "envelope_periods"("id", "budget_id");

-- CreateIndex
CREATE UNIQUE INDEX "envelope_periods_id_budget_id_envelope_id_key" ON "envelope_periods"("id", "budget_id", "envelope_id");

-- CreateIndex
CREATE UNIQUE INDEX "envelope_periods_budget_id_envelope_id_starts_on_key" ON "envelope_periods"("budget_id", "envelope_id", "starts_on");

-- CreateIndex
CREATE INDEX "envelope_funding_rules_budget_id_envelope_id_priority_idx" ON "envelope_funding_rules"("budget_id", "envelope_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "envelope_funding_rules_id_budget_id_key" ON "envelope_funding_rules"("id", "budget_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_cycle_revisions_budget_id_effective_on_key" ON "budget_cycle_revisions"("budget_id", "effective_on");

-- AddForeignKey
ALTER TABLE "envelope_periods" ADD CONSTRAINT "envelope_periods_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envelope_periods" ADD CONSTRAINT "envelope_periods_envelope_id_budget_id_fkey" FOREIGN KEY ("envelope_id", "budget_id") REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envelope_funding_rules" ADD CONSTRAINT "envelope_funding_rules_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envelope_funding_rules" ADD CONSTRAINT "envelope_funding_rules_envelope_id_budget_id_fkey" FOREIGN KEY ("envelope_id", "budget_id") REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_cycle_revisions" ADD CONSTRAINT "budget_cycle_revisions_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "envelope_periods" ADD CONSTRAINT "envelope_periods_ends_check" CHECK ("ends_on" >= "starts_on");

-- AlterTable
ALTER TABLE "envelope_periods" ADD CONSTRAINT "envelope_periods_target_status_check" CHECK (("target_status" = 'UNSET' AND "target_minor" IS NULL) OR ("target_status" IN ('DRAFT', 'CONFIRMED') AND "target_minor" >= 0));

-- AlterTable
ALTER TABLE "envelope_periods" ADD CONSTRAINT "envelope_periods_confirmed_check" CHECK (("target_status" = 'CONFIRMED' AND "confirmed_by_user_id" IS NOT NULL AND "confirmed_at" IS NOT NULL) OR ("target_status" <> 'CONFIRMED' AND "confirmed_by_user_id" IS NULL AND "confirmed_at" IS NULL));

-- AlterTable
ALTER TABLE "envelope_funding_rules" ADD CONSTRAINT "envelope_funding_rules_percent_check" CHECK ("percent_basis_points" IS NULL OR ("percent_basis_points" >= 0 AND "percent_basis_points" <= 10000));
