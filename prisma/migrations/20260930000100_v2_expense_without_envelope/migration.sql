-- Envelope Plan v2.2 (O03): an ordinary v2 expense may have no envelope.
-- Model 1 transactions keep the original invariant (expense requires envelope).
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_expense_requires_envelope_check";
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_expense_requires_envelope_check"
  CHECK ("transaction_type" <> 'EXPENSE' OR "envelope_id" IS NOT NULL OR "accounting_model_version" = 2);
