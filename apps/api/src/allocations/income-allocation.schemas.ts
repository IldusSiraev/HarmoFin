import { z } from 'zod';

const amount = z.string().min(1).max(64);
const occurredOn = z.string().date();
const accountId = z.string().uuid();
const envelopeId = z.string().uuid();
const comment = z.string().trim().min(1).max(500).nullable().optional();

export const createIncomeAllocationSchema = z
  .object({ amount, occurredOn, accountId, envelopeId, comment })
  .strict();

export const updateIncomeAllocationSchema = z
  .object({
    amount: amount.optional(),
    occurredOn: occurredOn.optional(),
    accountId: accountId.optional(),
    envelopeId: envelopeId.optional(),
    comment,
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Необходимо передать хотя бы одно поле для изменения.',
  });

export type CreateIncomeAllocationInput = z.output<typeof createIncomeAllocationSchema>;
export type UpdateIncomeAllocationInput = z.output<typeof updateIncomeAllocationSchema>;
