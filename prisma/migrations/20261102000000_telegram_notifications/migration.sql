-- Telegram notifications: per-user private chat link and one-time link codes.
-- Additive: one enum value, two new tables; no backfill.

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'TELEGRAM';

-- CreateTable
CREATE TABLE "telegram_links" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "consented_at" TIMESTAMPTZ(3) NOT NULL,
    "linked_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_link_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "consented_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_links_user_id_key" ON "telegram_links"("user_id");
CREATE UNIQUE INDEX "telegram_links_chat_id_key" ON "telegram_links"("chat_id");
CREATE UNIQUE INDEX "telegram_link_codes_code_hash_key" ON "telegram_link_codes"("code_hash");
CREATE INDEX "telegram_link_codes_user_id_consumed_at_expires_at_idx" ON "telegram_link_codes"("user_id", "consumed_at", "expires_at");

-- AddForeignKey
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
