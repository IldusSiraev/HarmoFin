-- Onboarding: the owner stated the budget has no mandatory payments.
-- Additive and nullable: existing rows stay NULL, old code ignores the column.
ALTER TABLE "budgets" ADD COLUMN "onboarding_no_mandatory_plans_at" TIMESTAMPTZ(3);
