import { z } from 'zod';

const uuid = z.string().uuid();

export const createTransactionV2Schema = z
  .object({
    transactionType: z.enum(['INCOME', 'EXPENSE']),
    status: z.enum(['DRAFT', 'CONFIRMED']),
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .refine((v) => Number(v) > 0, { message: 'Сумма должна быть больше нуля.' }),
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    accountId: uuid,
    categoryId: uuid,
    envelopeId: uuid.nullable().optional(),
    comment: z.string().max(500).optional(),
  })
  .strict();

export type CreateTransactionV2Input = z.infer<typeof createTransactionV2Schema>;
