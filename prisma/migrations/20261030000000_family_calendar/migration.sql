-- Family calendar: shared events and reminders.
-- Additive: new enum values, new tables with FKs to existing budgets/workspaces/users.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CALENDAR_REMINDER';
ALTER TYPE "WorkerJobType" ADD VALUE IF NOT EXISTS 'EVALUATE_CALENDAR_REMINDERS';

-- CreateEnum
CREATE TYPE "CalendarRecurrence" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "all_day" BOOLEAN NOT NULL,
    "starts_on" DATE,
    "ends_on" DATE,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "recurrence" "CalendarRecurrence" NOT NULL DEFAULT 'NONE',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "repeat_until" DATE,
    "reminder_minutes" INTEGER,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "calendar_events_title_not_blank" CHECK (length(btrim("title")) > 0),
    CONSTRAINT "calendar_events_day_or_time" CHECK (
      ("all_day" AND "starts_on" IS NOT NULL AND "ends_on" IS NOT NULL AND "starts_at" IS NULL AND "ends_at" IS NULL AND "ends_on" >= "starts_on" AND "ends_on" - "starts_on" <= 30)
      OR
      (NOT "all_day" AND "starts_at" IS NOT NULL AND "ends_at" IS NOT NULL AND "starts_on" IS NULL AND "ends_on" IS NULL AND "ends_at" >= "starts_at" AND "ends_at" - "starts_at" <= INTERVAL '24 hours')
    ),
    CONSTRAINT "calendar_events_interval_range" CHECK ("interval" BETWEEN 1 AND 99),
    CONSTRAINT "calendar_events_weekdays_rule" CHECK (
      ("recurrence" = 'WEEKLY' AND cardinality("weekdays") BETWEEN 1 AND 7 AND "weekdays" <@ ARRAY[1,2,3,4,5,6,7])
      OR ("recurrence" <> 'WEEKLY' AND cardinality("weekdays") = 0)
    ),
    CONSTRAINT "calendar_events_repeat_until_rule" CHECK ("repeat_until" IS NULL OR "recurrence" <> 'NONE'),
    CONSTRAINT "calendar_events_reminder_minutes" CHECK ("reminder_minutes" IS NULL OR "reminder_minutes" IN (15, 60, 1440, 10080))
);

CREATE TABLE "calendar_event_participants" (
    "event_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    CONSTRAINT "calendar_event_participants_pkey" PRIMARY KEY ("event_id", "user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_id_budget_id_key" ON "calendar_events"("id", "budget_id");
CREATE INDEX "calendar_events_budget_id_deleted_at_idx" ON "calendar_events"("budget_id", "deleted_at");
CREATE INDEX "calendar_events_budget_id_created_by_user_id_idx" ON "calendar_events"("budget_id", "created_by_user_id");
CREATE INDEX "calendar_events_reminders_idx" ON "calendar_events"("budget_id") WHERE "reminder_minutes" IS NOT NULL AND "deleted_at" IS NULL;
CREATE INDEX "calendar_event_participants_budget_id_user_id_idx" ON "calendar_event_participants"("budget_id", "user_id");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_budget_id_workspace_id_fkey" FOREIGN KEY ("budget_id", "workspace_id") REFERENCES "budgets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_event_id_budget_id_fkey" FOREIGN KEY ("event_id", "budget_id") REFERENCES "calendar_events"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
