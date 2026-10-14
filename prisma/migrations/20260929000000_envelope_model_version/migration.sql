-- AlterTable
ALTER TABLE "budgets" ADD COLUMN "plan_model_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_plan_model_version_check" CHECK ("plan_model_version" IN (1, 2));

-- AlterTable
ALTER TABLE "budgets" ADD COLUMN "plan_model_activated_on" DATE;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "accounting_model_version" INTEGER NOT NULL DEFAULT 1;
