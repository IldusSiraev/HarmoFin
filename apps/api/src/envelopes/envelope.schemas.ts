import { z } from 'zod';

const envelopeTypes = [
  'CURRENT_EXPENSES',
  'MANDATORY_EXPENSES',
  'SAVINGS_GOAL',
  'RESERVE',
  'FREE_MONEY',
  'CUSTOM',
] as const;

const periodSlot = z.enum(['FIRST', 'SECOND']).nullable().optional();

const envelopeFields = {
  name: z.string().trim().min(1).max(120),
  envelopeType: z.enum(envelopeTypes),
  periodSlot,
  currency: z.literal('RUB'),
  startingBalance: z.string().min(1).max(64),
  monthlyPlannedAmount: z.string().min(1).max(64).nullable().optional(),
  targetAmount: z.string().min(1).max(64).nullable().optional(),
  targetDate: z.string().date().nullable().optional(),
  displayOrder: z.number().int().min(0).max(1_000_000),
  comment: z.string().trim().min(1).max(500).nullable().optional(),
};

export const createEnvelopeSchema = z.object(envelopeFields).strict();

export const updateEnvelopeSchema = z
  .object({
    name: envelopeFields.name.optional(),
    envelopeType: envelopeFields.envelopeType.optional(),
    periodSlot,
    startingBalance: envelopeFields.startingBalance.optional(),
    monthlyPlannedAmount: envelopeFields.monthlyPlannedAmount,
    targetAmount: envelopeFields.targetAmount,
    targetDate: envelopeFields.targetDate,
    displayOrder: envelopeFields.displayOrder.optional(),
    comment: envelopeFields.comment,
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Необходимо передать хотя бы одно поле для изменения.',
  });

export const listEnvelopesSchema = z
  .object({ status: z.enum(['active', 'archived', 'all']).default('active') })
  .strict();

export type CreateEnvelopeInput = z.output<typeof createEnvelopeSchema>;
export type UpdateEnvelopeInput = z.output<typeof updateEnvelopeSchema>;
export type ListEnvelopesInput = z.output<typeof listEnvelopesSchema>;
