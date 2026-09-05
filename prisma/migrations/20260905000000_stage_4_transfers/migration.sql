CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED');

CREATE TABLE "transfers" (
  "id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
  "total_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
  "scale" SMALLINT NOT NULL DEFAULT 2,
  "occurred_on" DATE NOT NULL,
  "comment" VARCHAR(500),
  "confirmed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3),
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transfers_id_budget_id_key" UNIQUE ("id", "budget_id"),
  CONSTRAINT "transfers_budget_id_fkey"
    FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transfers_total_minor_positive_check" CHECK ("total_minor" > 0),
  CONSTRAINT "transfers_currency_check" CHECK ("currency" = 'RUB'),
  CONSTRAINT "transfers_scale_check" CHECK ("scale" = 2),
  CONSTRAINT "transfers_status_lifecycle_check" CHECK (
    ("status" <> 'CONFIRMED' OR "confirmed_at" IS NOT NULL)
    AND ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL)
    AND ("status" <> 'DELETED' OR "deleted_at" IS NOT NULL)
  )
);

CREATE TABLE "transfer_parts" (
  "id" UUID NOT NULL,
  "transfer_id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "source_account_id" UUID NOT NULL,
  "destination_account_id" UUID NOT NULL,
  "source_envelope_id" UUID NOT NULL,
  "destination_envelope_id" UUID NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "comment" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "transfer_parts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transfer_parts_id_budget_id_key" UNIQUE ("id", "budget_id"),
  CONSTRAINT "transfer_parts_transfer_budget_fkey"
    FOREIGN KEY ("transfer_id", "budget_id") REFERENCES "transfers"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transfer_parts_source_account_budget_fkey"
    FOREIGN KEY ("source_account_id", "budget_id") REFERENCES "accounts"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transfer_parts_destination_account_budget_fkey"
    FOREIGN KEY ("destination_account_id", "budget_id") REFERENCES "accounts"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transfer_parts_source_envelope_budget_fkey"
    FOREIGN KEY ("source_envelope_id", "budget_id") REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transfer_parts_destination_envelope_budget_fkey"
    FOREIGN KEY ("destination_envelope_id", "budget_id") REFERENCES "envelopes"("id", "budget_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transfer_parts_amount_minor_positive_check" CHECK ("amount_minor" > 0)
);

CREATE INDEX "transfers_budget_id_occurred_on_created_at_idx"
  ON "transfers" ("budget_id", "occurred_on", "created_at");
CREATE INDEX "transfers_budget_id_status_occurred_on_idx"
  ON "transfers" ("budget_id", "status", "occurred_on");
CREATE INDEX "transfer_parts_budget_id_source_account_id_idx"
  ON "transfer_parts" ("budget_id", "source_account_id");
CREATE INDEX "transfer_parts_budget_id_destination_account_id_idx"
  ON "transfer_parts" ("budget_id", "destination_account_id");
CREATE INDEX "transfer_parts_budget_id_source_envelope_id_idx"
  ON "transfer_parts" ("budget_id", "source_envelope_id");
CREATE INDEX "transfer_parts_budget_id_destination_envelope_id_idx"
  ON "transfer_parts" ("budget_id", "destination_envelope_id");
