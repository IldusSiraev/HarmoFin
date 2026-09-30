import { z } from 'zod';

const decimalAmount = z.string().min(1).max(64);
const periodSlot = z.enum(['FIRST', 'SECOND']);

export const createEnvelopeSchema = z
  .object({
    name: z.string().min(1).max(120),
    envelopeType: z.enum([
      'CURRENT_EXPENSES',
      'MANDATORY_EXPENSES',
      'SAVINGS_GOAL',
      'RESERVE',
      'CUSTOM',
    ]),
    periodSlot: periodSlot.optional(),
    targetAmountMinor: decimalAmount.optional(),
    comment: z.string().max(500).optional(),
  })
  .strict();

export type CreateEnvelopeInput = z.output<typeof createEnvelopeSchema>;

export const updateEnvelopeSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    periodSlot: periodSlot.optional(),
  })
  .strict();

export type UpdateEnvelopeInput = z.output<typeof updateEnvelopeSchema>;

const uuid = z.string().uuid();

export const createAssignmentSchema = z
  .object({
    envelopeId: uuid,
    incomeTransactionId: uuid.optional(),
    periodId: uuid.optional(),
    amount: decimalAmount,
    sourceKind: z.enum(['FREE', 'INCOME']),
  })
  .strict()
  .refine((value) => value.sourceKind !== 'INCOME' || value.incomeTransactionId !== undefined, {
    message: 'Для sourceKind=INCOME обязательно поле incomeTransactionId.',
    path: ['incomeTransactionId'],
  })
  .refine((value) => value.sourceKind !== 'FREE' || value.incomeTransactionId === undefined, {
    message: 'Поле incomeTransactionId допустимо только для sourceKind=INCOME.',
    path: ['incomeTransactionId'],
  });

export type CreateAssignmentInput = z.output<typeof createAssignmentSchema>;

export const envelopeHistorySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(256).optional(),
    status: z.enum(['CONFIRMED', 'DELETED']).optional(),
  })
  .strict();

export type EnvelopeHistoryQuery = z.output<typeof envelopeHistorySchema>;
