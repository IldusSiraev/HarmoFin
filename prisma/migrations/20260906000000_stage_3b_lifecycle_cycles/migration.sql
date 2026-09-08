CREATE TYPE "PeriodSlot" AS ENUM ('FIRST', 'SECOND');

ALTER TABLE "envelopes" ADD COLUMN "period_slot" "PeriodSlot";
ALTER TABLE "transactions" ADD COLUMN "pre_delete_status" "TransactionStatus";
ALTER TABLE "income_allocations" ADD COLUMN "pre_delete_status" "IncomeAllocationStatus";

UPDATE "envelopes"
SET "period_slot" = CASE "template_key"
  WHEN 'envelope-current-10-24' THEN 'FIRST'::"PeriodSlot"
  WHEN 'envelope-current-25-9' THEN 'SECOND'::"PeriodSlot"
END
WHERE "template_key" IN ('envelope-current-10-24', 'envelope-current-25-9')
  AND "archived_at" IS NULL;

UPDATE "transactions"
SET "pre_delete_status" = CASE
  WHEN "cancelled_at" IS NOT NULL THEN 'CANCELLED'::"TransactionStatus"
  WHEN "confirmed_at" IS NOT NULL THEN 'CONFIRMED'::"TransactionStatus"
  ELSE 'DRAFT'::"TransactionStatus"
END
WHERE "status" = 'DELETED';

UPDATE "income_allocations"
SET "pre_delete_status" = 'CONFIRMED'::"IncomeAllocationStatus"
WHERE "status" = 'DELETED';

ALTER TABLE "envelopes"
  ADD CONSTRAINT "envelopes_period_slot_current_expenses_check"
  CHECK ("period_slot" IS NULL OR "envelope_type" = 'CURRENT_EXPENSES');

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_pre_delete_status_check"
  CHECK (("status" = 'DELETED') = ("pre_delete_status" IS NOT NULL)),
  ADD CONSTRAINT "transactions_pre_delete_status_value_check"
  CHECK ("pre_delete_status" IS NULL OR "pre_delete_status" IN ('DRAFT', 'CONFIRMED', 'CANCELLED'));

ALTER TABLE "income_allocations"
  ADD CONSTRAINT "income_allocations_pre_delete_status_check"
  CHECK (("status" = 'DELETED') = ("pre_delete_status" IS NOT NULL)),
  ADD CONSTRAINT "income_allocations_pre_delete_status_value_check"
  CHECK ("pre_delete_status" IS NULL OR "pre_delete_status" IN ('CONFIRMED', 'CANCELLED'));

CREATE UNIQUE INDEX "envelopes_active_period_slot_key"
  ON "envelopes" ("budget_id", "period_slot")
  WHERE "archived_at" IS NULL AND "period_slot" IS NOT NULL;
