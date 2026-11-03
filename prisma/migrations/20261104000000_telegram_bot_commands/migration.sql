-- Telegram bot commands: per-chat switch with consent and the state of one step-by-step dialog.
-- Additive: two nullable columns, one new table; no backfill.

-- AlterTable
ALTER TABLE "telegram_links" ADD COLUMN "commands_enabled_at" TIMESTAMPTZ(3),
ADD COLUMN "commands_consent_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "telegram_dialogs" (
    "id" UUID NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "user_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "step" VARCHAR(32) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL DEFAULT '{}',
    "message_id" INTEGER,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "telegram_dialogs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_dialogs_chat_id_key" ON "telegram_dialogs"("chat_id");
CREATE INDEX "telegram_dialogs_expires_at_idx" ON "telegram_dialogs"("expires_at");

-- AddForeignKey
ALTER TABLE "telegram_dialogs" ADD CONSTRAINT "telegram_dialogs_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "telegram_links"("chat_id") ON DELETE CASCADE ON UPDATE CASCADE;
