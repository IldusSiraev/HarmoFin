-- Additive only: consent proof for legal documents.
CREATE TYPE "LegalDocumentType" AS ENUM ('TERMS', 'PRIVACY_POLICY', 'PD_CONSENT');

CREATE TABLE "user_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document" "LegalDocumentType" NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_consents_user_id_document_version_key" ON "user_consents"("user_id", "document", "version");

ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
