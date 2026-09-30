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
