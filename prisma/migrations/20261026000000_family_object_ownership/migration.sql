-- Family access, stage B: object owners and allocation authors.
-- Additive: nullable columns, backfill, then NOT NULL, foreign keys and indexes.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'OBJECTS_TRANSFERRED';

ALTER TABLE "accounts" ADD COLUMN "owner_user_id" UUID;
ALTER TABLE "envelopes" ADD COLUMN "owner_user_id" UUID;
ALTER TABLE "regular_plans" ADD COLUMN "owner_user_id" UUID;
ALTER TABLE "envelope_assignments" ADD COLUMN "created_by_user_id" UUID;
ALTER TABLE "envelope_movements" ADD COLUMN "created_by_user_id" UUID;

-- Accounts and envelopes existed before ownership: they belong to the family creator.
UPDATE "accounts" AS a
SET "owner_user_id" = w."owner_id"
FROM "budgets" AS b
JOIN "workspaces" AS w ON w."id" = b."workspace_id"
WHERE b."id" = a."budget_id";

UPDATE "envelopes" AS e
SET "owner_user_id" = w."owner_id"
FROM "budgets" AS b
JOIN "workspaces" AS w ON w."id" = b."workspace_id"
WHERE b."id" = e."budget_id";

-- Plans keep their creator when that person is still an active writer of the family.
UPDATE "regular_plans" AS p
SET "owner_user_id" = p."created_by_user_id"
WHERE EXISTS (
  SELECT 1 FROM "workspace_memberships" AS m
  WHERE m."workspace_id" = p."workspace_id"
    AND m."user_id" = p."created_by_user_id"
    AND m."is_active" = true
    AND m."role" IN ('OWNER', 'EDITOR')
);

UPDATE "regular_plans" AS p
SET "owner_user_id" = w."owner_id"
FROM "workspaces" AS w
WHERE w."id" = p."workspace_id" AND p."owner_user_id" IS NULL;

-- Allocation author: who created it (audit), else the income author, else the creator.
UPDATE "envelope_assignments" AS a
SET "created_by_user_id" = ae."actor_user_id"
FROM (
  SELECT DISTINCT ON ("entity_id") "entity_id", "actor_user_id"
  FROM "audit_events"
  WHERE "entity_type" = 'envelope-assignment'
    AND "action" = 'CREATED'
    AND "actor_user_id" IS NOT NULL
    AND "entity_id" IS NOT NULL
  ORDER BY "entity_id", "created_at"
) AS ae
WHERE ae."entity_id" = a."id";

UPDATE "envelope_assignments" AS a
SET "created_by_user_id" = t."created_by_user_id"
FROM "transactions" AS t
WHERE a."created_by_user_id" IS NULL
  AND t."id" = a."source_income_transaction_id"
  AND t."budget_id" = a."budget_id";

UPDATE "envelope_assignments" AS a
SET "created_by_user_id" = w."owner_id"
FROM "budgets" AS b
JOIN "workspaces" AS w ON w."id" = b."workspace_id"
WHERE a."created_by_user_id" IS NULL AND b."id" = a."budget_id";

UPDATE "envelope_movements" AS m
SET "created_by_user_id" = ae."actor_user_id"
FROM (
  SELECT DISTINCT ON ("entity_id") "entity_id", "actor_user_id"
  FROM "audit_events"
  WHERE "entity_type" = 'envelope-movement'
    AND "action" = 'CREATED'
    AND "actor_user_id" IS NOT NULL
    AND "entity_id" IS NOT NULL
  ORDER BY "entity_id", "created_at"
) AS ae
WHERE ae."entity_id" = m."id";

UPDATE "envelope_movements" AS m
SET "created_by_user_id" = w."owner_id"
FROM "budgets" AS b
JOIN "workspaces" AS w ON w."id" = b."workspace_id"
WHERE m."created_by_user_id" IS NULL AND b."id" = m."budget_id";

ALTER TABLE "accounts" ALTER COLUMN "owner_user_id" SET NOT NULL;
ALTER TABLE "envelopes" ALTER COLUMN "owner_user_id" SET NOT NULL;
ALTER TABLE "regular_plans" ALTER COLUMN "owner_user_id" SET NOT NULL;
ALTER TABLE "envelope_assignments" ALTER COLUMN "created_by_user_id" SET NOT NULL;
ALTER TABLE "envelope_movements" ALTER COLUMN "created_by_user_id" SET NOT NULL;

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "regular_plans" ADD CONSTRAINT "regular_plans_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "envelope_assignments" ADD CONSTRAINT "envelope_assignments_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "envelope_movements" ADD CONSTRAINT "envelope_movements_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "accounts_budget_id_owner_user_id_idx" ON "accounts"("budget_id", "owner_user_id");
CREATE INDEX "envelopes_budget_id_owner_user_id_idx" ON "envelopes"("budget_id", "owner_user_id");
CREATE INDEX "regular_plans_budget_id_owner_user_id_idx" ON "regular_plans"("budget_id", "owner_user_id");
