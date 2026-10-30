-- Family activity feed: per-member "seen" marker.
-- Additive: one new table with FKs to existing workspaces/budgets/users, no backfill.

-- CreateTable
CREATE TABLE "activity_feed_cursors" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "seen_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "activity_feed_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_feed_cursors_budget_id_user_id_key" ON "activity_feed_cursors"("budget_id", "user_id");

-- AddForeignKey
ALTER TABLE "activity_feed_cursors" ADD CONSTRAINT "activity_feed_cursors_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_feed_cursors" ADD CONSTRAINT "activity_feed_cursors_budget_id_workspace_id_fkey" FOREIGN KEY ("budget_id", "workspace_id") REFERENCES "budgets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_feed_cursors" ADD CONSTRAINT "activity_feed_cursors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
