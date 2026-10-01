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

export const budgetIdParamSchema = uuid;
export const transactionIdParamSchema = uuid;

/** Journal filters; the sort order is fixed: occurredOn desc, createdAt desc, id desc. */
export const listTransactionsV2Schema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(512).optional(),
    type: z.enum(['INCOME', 'EXPENSE']).optional(),
    status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED']).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    accountId: uuid.optional(),
    categoryId: uuid.optional(),
    envelopeId: uuid.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.from && input.to && input.from > input.to) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Дата окончания не может быть раньше даты начала.',
      });
    }
  });

export type ListTransactionsV2Input = z.output<typeof listTransactionsV2Schema>;
