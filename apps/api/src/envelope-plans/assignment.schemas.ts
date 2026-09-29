import { z } from 'zod';

const amount = z.string().min(1).max(64);
const periodId = z.string().uuid().optional();
const uuid = z.string().uuid();

export const createEnvelopeAssignmentSchema = z
  .object({
    envelopeId: uuid,
    periodId,
    amount,
    sourceKind: z.enum(['OPENING', 'FREE']),
  })
  .strict();

export type CreateEnvelopeAssignmentInput = z.output<typeof createEnvelopeAssignmentSchema>;

export const createIncomeAssignmentSchema = z
  .object({
    incomeTransactionId: uuid,
    envelopeId: uuid,
    periodId,
    amount,
  })
  .strict();

export type CreateIncomeAssignmentInput = z.output<typeof createIncomeAssignmentSchema>;

export const reviseAssignmentSchema = z
  .object({
    amount,
  })
  .strict();

export type ReviseAssignmentInput = z.output<typeof reviseAssignmentSchema>;
