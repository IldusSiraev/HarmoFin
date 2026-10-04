-- New budgets default to plan model 2. Existing rows are not rewritten.
-- plan_model_activated_on intentionally has no DB default: it is set by the
-- application in the budget timezone (CURRENT_DATE may differ).
-- Deploy together with the application change while old writers are stopped.
ALTER TABLE "budgets" ALTER COLUMN "plan_model_version" SET DEFAULT 2;

ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_plan_model_v2_activated_on_check"
  CHECK ("plan_model_version" = 1 OR "plan_model_activated_on" IS NOT NULL) NOT VALID;
ALTER TABLE "budgets" VALIDATE CONSTRAINT "budgets_plan_model_v2_activated_on_check";
