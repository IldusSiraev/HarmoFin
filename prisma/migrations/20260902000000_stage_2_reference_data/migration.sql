CREATE TYPE "AccountType" AS ENUM ('BANK_ACCOUNT', 'BANK_CARD', 'CASH');
CREATE TYPE "CategoryType" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "EnvelopeType" AS ENUM (
  'CURRENT_EXPENSES',
  'MANDATORY_EXPENSES',
  'SAVINGS_GOAL',
  'RESERVE',
  'FREE_MONEY',
  'CUSTOM'
);

ALTER TABLE "budgets"
  ADD COLUMN "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',
  ADD COLUMN "income_allocation_rule_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "income_allocation_source_category_id" UUID,
  ADD COLUMN "income_allocation_target_envelope_id" UUID;

CREATE TABLE "accounts" (
  "id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "account_type" "AccountType" NOT NULL,
  "bank_name" VARCHAR(120),
  "last_four_digits" CHAR(4),
  "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
  "scale" SMALLINT NOT NULL DEFAULT 2,
  "starting_balance_minor" BIGINT NOT NULL,
  "accounting_start_date" DATE NOT NULL,
  "comment" VARCHAR(500),
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounts_budget_id_fkey"
    FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accounts_currency_check" CHECK ("currency" = 'RUB'),
  CONSTRAINT "accounts_scale_check" CHECK ("scale" = 2),
  CONSTRAINT "accounts_last_four_digits_check"
    CHECK ("last_four_digits" IS NULL OR "last_four_digits" ~ '^[0-9]{4}$')
);

CREATE TABLE "categories" (
  "id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "template_key" VARCHAR(80),
  "name" VARCHAR(120) NOT NULL,
  "category_type" "CategoryType" NOT NULL,
  "parent_id" UUID,
  "display_order" INTEGER NOT NULL,
  "comment" VARCHAR(500),
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "categories_id_budget_id_key" UNIQUE ("id", "budget_id"),
  CONSTRAINT "categories_budget_id_fkey"
    FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "categories_parent_budget_fkey"
    FOREIGN KEY ("parent_id", "budget_id") REFERENCES "categories"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "categories_display_order_check" CHECK ("display_order" >= 0),
  CONSTRAINT "categories_parent_not_self_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);

CREATE TABLE "envelopes" (
  "id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "template_key" VARCHAR(80),
  "name" VARCHAR(120) NOT NULL,
  "envelope_type" "EnvelopeType" NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
  "scale" SMALLINT NOT NULL DEFAULT 2,
  "starting_balance_minor" BIGINT NOT NULL,
  "monthly_planned_amount_minor" BIGINT,
  "target_amount_minor" BIGINT,
  "target_date" DATE,
  "display_order" INTEGER NOT NULL,
  "comment" VARCHAR(500),
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "envelopes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "envelopes_id_budget_id_key" UNIQUE ("id", "budget_id"),
  CONSTRAINT "envelopes_budget_id_fkey"
    FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "envelopes_currency_check" CHECK ("currency" = 'RUB'),
  CONSTRAINT "envelopes_scale_check" CHECK ("scale" = 2),
  CONSTRAINT "envelopes_display_order_check" CHECK ("display_order" >= 0),
  CONSTRAINT "envelopes_monthly_planned_non_negative_check"
    CHECK ("monthly_planned_amount_minor" IS NULL OR "monthly_planned_amount_minor" >= 0),
  CONSTRAINT "envelopes_target_amount_non_negative_check"
    CHECK ("target_amount_minor" IS NULL OR "target_amount_minor" >= 0),
  CONSTRAINT "envelopes_target_date_requires_amount_check"
    CHECK ("target_date" IS NULL OR "target_amount_minor" IS NOT NULL)
);

ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_income_allocation_source_category_budget_fkey"
    FOREIGN KEY ("income_allocation_source_category_id", "id")
    REFERENCES "categories"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "budgets_income_allocation_target_envelope_budget_fkey"
    FOREIGN KEY ("income_allocation_target_envelope_id", "id")
    REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "accounts_active_budget_name_key"
  ON "accounts" ("budget_id", lower("name")) WHERE "archived_at" IS NULL;
CREATE INDEX "accounts_budget_id_archived_at_idx"
  ON "accounts" ("budget_id", "archived_at");
CREATE UNIQUE INDEX "categories_active_budget_type_name_key"
  ON "categories" ("budget_id", "category_type", lower("name")) WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "categories_budget_template_key_key"
  ON "categories" ("budget_id", "template_key") WHERE "template_key" IS NOT NULL;
CREATE INDEX "categories_budget_type_archived_idx"
  ON "categories" ("budget_id", "category_type", "archived_at");
CREATE UNIQUE INDEX "envelopes_active_budget_name_key"
  ON "envelopes" ("budget_id", lower("name")) WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "envelopes_budget_template_key_key"
  ON "envelopes" ("budget_id", "template_key") WHERE "template_key" IS NOT NULL;
CREATE INDEX "envelopes_budget_id_archived_at_idx"
  ON "envelopes" ("budget_id", "archived_at");
