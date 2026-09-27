import { z } from 'zod';

const amount = z.string().min(1).max(64);
const date = z.string().date();
const uuid = z.string().uuid();
const comment = z.string().trim().min(1).max(500).nullable().optional();

export const createEnvelopeReallocationSchema = z
  .object({
    sourceEnvelopeId: uuid,
    destinationEnvelopeId: uuid,
    amount,
    occurredOn: date,
    comment,
  })
  .strict();

export const listEnvelopeReallocationsSchema = z
  .object({
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    envelopeId: uuid.optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .strict();

export type CreateEnvelopeReallocationInput = z.output<typeof createEnvelopeReallocationSchema>;
export type ListEnvelopeReallocationsInput = z.output<typeof listEnvelopeReallocationsSchema>;
