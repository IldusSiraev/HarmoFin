import { z } from 'zod';

const amount = z.string().min(1).max(64);
const date = z.string().date();
const uuid = z.string().uuid();
const comment = z.string().trim().min(1).max(500).nullable().optional();

const transferPartSchema = z
  .object({
    sourceEnvelopeId: uuid,
    destinationEnvelopeId: uuid.optional(),
    amount,
    comment,
  })
  .strict();

export const createTransferSchema = z
  .object({
    status: z.enum(['DRAFT', 'CONFIRMED']).default('DRAFT'),
    total: amount,
    occurredOn: date,
    sourceAccountId: uuid,
    destinationAccountId: uuid,
    parts: z.array(transferPartSchema).min(1).max(100),
    comment,
  })
  .strict();

export const listTransfersSchema = z
  .object({
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED']).optional(),
    from: date.optional(),
    to: date.optional(),
    accountId: uuid.optional(),
    envelopeId: uuid.optional(),
  })
  .strict();

export type CreateTransferInput = z.output<typeof createTransferSchema>;
export type ListTransfersInput = z.output<typeof listTransfersSchema>;
