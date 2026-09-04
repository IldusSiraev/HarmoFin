ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_id_budget_id_key" UNIQUE ("id", "budget_id");

CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "TransactionStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED');
CREATE TYPE "IncomeAllocationStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'DELETED');

CREATE TABLE "transactions" (
  "id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "transaction_type" "TransactionType" NOT NULL,
  "status" "TransactionStatus" NOT NULL DEFAULT 'DRAFT',
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
  "scale" SMALLINT NOT NULL DEFAULT 2,
  "occurred_on" DATE NOT NULL,
  "account_id" UUID NOT NULL,
  "category_id" UUID NOT NULL,
  "envelope_id" UUID,
  "source_description" VARCHAR(250),
  "merchant_name" VARCHAR(250),
  "is_planned" BOOLEAN NOT NULL DEFAULT false,
  "comment" VARCHAR(500),
  "confirmed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3),
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transactions_id_budget_id_key" UNIQUE ("id", "budget_id"),
  CONSTRAINT "transactions_budget_id_fkey"
    FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transactions_account_budget_fkey"
    FOREIGN KEY ("account_id", "budget_id") REFERENCES "accounts"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transactions_category_budget_fkey"
    FOREIGN KEY ("category_id", "budget_id") REFERENCES "categories"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transactions_envelope_budget_fkey"
    FOREIGN KEY ("envelope_id", "budget_id") REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transactions_currency_check" CHECK ("currency" = 'RUB'),
  CONSTRAINT "transactions_scale_check" CHECK ("scale" = 2),
  CONSTRAINT "transactions_amount_minor_positive_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "transactions_expense_requires_envelope_check"
    CHECK ("transaction_type" <> 'EXPENSE' OR "envelope_id" IS NOT NULL),
  CONSTRAINT "transactions_status_lifecycle_check" CHECK (
    ("status" <> 'CONFIRMED' OR "confirmed_at" IS NOT NULL)
    AND ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL)
    AND ("status" <> 'DELETED' OR "deleted_at" IS NOT NULL)
  )
);

CREATE TABLE "income_allocations" (
  "id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "income_transaction_id" UUID NOT NULL,
  "status" "IncomeAllocationStatus" NOT NULL DEFAULT 'CONFIRMED',
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
  "scale" SMALLINT NOT NULL DEFAULT 2,
  "occurred_on" DATE NOT NULL,
  "account_id" UUID NOT NULL,
  "envelope_id" UUID NOT NULL,
  "comment" VARCHAR(500),
  "deleted_at" TIMESTAMPTZ(3),
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "income_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "income_allocations_id_budget_id_key" UNIQUE ("id", "budget_id"),
  CONSTRAINT "income_allocations_budget_id_fkey"
    FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_allocations_income_transaction_budget_fkey"
    FOREIGN KEY ("income_transaction_id", "budget_id") REFERENCES "transactions"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_allocations_account_budget_fkey"
    FOREIGN KEY ("account_id", "budget_id") REFERENCES "accounts"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_allocations_envelope_budget_fkey"
    FOREIGN KEY ("envelope_id", "budget_id") REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "income_allocations_currency_check" CHECK ("currency" = 'RUB'),
  CONSTRAINT "income_allocations_scale_check" CHECK ("scale" = 2),
  CONSTRAINT "income_allocations_amount_minor_positive_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "income_allocations_status_lifecycle_check"
    CHECK ("status" <> 'DELETED' OR "deleted_at" IS NOT NULL)
);

CREATE TABLE "idempotency_records" (
  "id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "operation" VARCHAR(64) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "response_status" SMALLINT NOT NULL,
  "response_body" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "idempotency_records_budget_actor_key_key" UNIQUE ("budget_id", "actor_user_id", "key"),
  CONSTRAINT "idempotency_records_budget_id_fkey"
    FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "idempotency_records_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "transactions_budget_id_occurred_on_created_at_idx"
  ON "transactions" ("budget_id", "occurred_on", "created_at");
CREATE INDEX "transactions_budget_id_transaction_type_status_occurred_on_idx"
  ON "transactions" ("budget_id", "transaction_type", "status", "occurred_on");
CREATE INDEX "transactions_budget_id_account_id_occurred_on_idx"
  ON "transactions" ("budget_id", "account_id", "occurred_on");
CREATE INDEX "transactions_budget_id_category_id_occurred_on_idx"
  ON "transactions" ("budget_id", "category_id", "occurred_on");
CREATE INDEX "transactions_budget_id_envelope_id_occurred_on_idx"
  ON "transactions" ("budget_id", "envelope_id", "occurred_on");
CREATE INDEX "transactions_active_budget_occurred_idx"
  ON "transactions" ("budget_id", "occurred_on" DESC, "created_at" DESC)
  WHERE "status" <> 'DELETED';
CREATE INDEX "income_allocations_budget_id_income_transaction_id_status_idx"
  ON "income_allocations" ("budget_id", "income_transaction_id", "status");
CREATE INDEX "income_allocations_budget_id_envelope_id_occurred_on_idx"
  ON "income_allocations" ("budget_id", "envelope_id", "occurred_on");
CREATE INDEX "idempotency_records_created_at_idx" ON "idempotency_records" ("created_at");
