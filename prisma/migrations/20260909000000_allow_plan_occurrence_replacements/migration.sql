ALTER TABLE "plan_occurrences"
  DROP CONSTRAINT "plan_occurrences_plan_id_scheduled_on_key";

CREATE UNIQUE INDEX "plan_occurrences_active_plan_date_key"
  ON "plan_occurrences" ("plan_id", "scheduled_on")
  WHERE "status" <> 'CANCELLED';
