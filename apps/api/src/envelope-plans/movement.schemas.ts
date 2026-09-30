import { z } from 'zod';

const amount = z.string().min(1).max(64);
const uuid = z.string().uuid();

export const moveEnvelopeSchema = z
  .object({
    sourceEnvelopeId: uuid,
    sourcePeriodId: uuid.optional(),
    destinationEnvelopeId: z.union([uuid, z.null()]).optional(),
    destinationPeriodId: uuid.optional(),
    amount,
  })
  .strict();

export type MoveEnvelopeInput = z.output<typeof moveEnvelopeSchema>;
