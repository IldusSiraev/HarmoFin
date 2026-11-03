-- Calendar: up to three reminders per event. Additive: one array column filled from
-- reminder_minutes, which stays as the smallest offset so the previous release keeps working.

-- AlterTable: same form as "weekdays" (Prisma lists carry no NOT NULL); the check below forbids NULL.
ALTER TABLE "calendar_events" ADD COLUMN "reminder_offsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- Backfill
UPDATE "calendar_events" SET "reminder_offsets" = ARRAY["reminder_minutes"] WHERE "reminder_minutes" IS NOT NULL;

-- Checks
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_reminder_minutes";
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_reminder_minutes" CHECK (
  "reminder_minutes" IS NULL OR "reminder_minutes" IN (0, 5, 15, 30, 60, 120, 1440, 2880, 10080)
);
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_reminder_offsets" CHECK (
  "reminder_offsets" IS NOT NULL
  AND array_position("reminder_offsets", NULL) IS NULL
  AND cardinality("reminder_offsets") <= 3
  AND "reminder_offsets" <@ ARRAY[0, 5, 15, 30, 60, 120, 1440, 2880, 10080]
  AND (cardinality("reminder_offsets") < 2 OR "reminder_offsets"[1] < "reminder_offsets"[2])
  AND (cardinality("reminder_offsets") < 3 OR "reminder_offsets"[2] < "reminder_offsets"[3])
);

-- Index: the worker reads only events that have reminders.
DROP INDEX "calendar_events_reminders_idx";
CREATE INDEX "calendar_events_reminders_idx" ON "calendar_events"("budget_id") WHERE cardinality("reminder_offsets") > 0 AND "deleted_at" IS NULL;
