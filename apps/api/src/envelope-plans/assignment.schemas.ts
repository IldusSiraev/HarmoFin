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
