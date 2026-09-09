import {
  journalFilterSchema,
  validateJournalDateRange,
  type ListTransactionsInput,
} from '../transactions/transaction.schemas.js';

export const exportTransactionsSchema = journalFilterSchema
  .omit({ limit: true, cursor: true })
  .superRefine(validateJournalDateRange);

export type ExportTransactionsInput = Omit<ListTransactionsInput, 'limit' | 'cursor'>;
