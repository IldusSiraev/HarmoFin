-- AlterTable
ALTER TABLE "envelope_movements" DROP CONSTRAINT "envelope_movements_destination_null_together_check";

-- AlterTable
ALTER TABLE "envelope_movements" ADD CONSTRAINT "envelope_movements_destination_period_requires_envelope_check" CHECK (NOT ("destination_envelope_id" IS NULL AND "destination_period_id" IS NOT NULL));
