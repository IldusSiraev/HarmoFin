import { z } from 'zod';

const amount = z.string().min(1).max(64);
const occurredOn = z.string().date();
const accountId = z.string().uuid();
const categoryId = z.string().uuid();
const envelopeId = z.string().uuid();
const comment = z.string().trim().min(1).max(500).nullable().optional();
const sourceDescription = z.string().trim().min(1).max(250).nullable().optional();
const merchantName = z.string().trim().min(1).max(250).nullable().optional();

export const createTransactionSchema = z
  .object({
    transactionType: z.enum(['INCOME', 'EXPENSE']),
    status: z.enum(['DRAFT', 'CONFIRMED']).default('DRAFT'),
    amount,
    occurredOn,
    accountId,
    categoryId,
    envelopeId: envelopeId.nullable().optional(),
    sourceDescription,
    merchantName,
    isPlanned: z.boolean().default(false),
    comment,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.transactionType === 'INCOME') {
      if (input.envelopeId !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['envelopeId'],
          message: 'Доход не использует конверт.',
        });
      }
      if (input.merchantName !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['merchantName'],
          message: 'Доход не использует торговую точку.',
        });
      }
      return;
    }

    if (!input.envelopeId) {
      context.addIssue({
        code: 'custom',
        path: ['envelopeId'],
        message: 'Укажите конверт расхода.',
      });
    }
    if (input.sourceDescription !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['sourceDescription'],
        message: 'Расход не использует источник дохода.',
      });
    }
  });

export const updateTransactionSchema = z
  .object({
    amount: amount.optional(),
    occurredOn: occurredOn.optional(),
    accountId: accountId.optional(),
    categoryId: categoryId.optional(),
    envelopeId: envelopeId.nullable().optional(),
    sourceDescription,
    merchantName,
    isPlanned: z.boolean().optional(),
    comment,
    confirm: z.literal(true).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'confirm'), {
    message: 'Необходимо передать хотя бы одно поле для изменения.',
  });

export const listTransactionsSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(512).optional(),
    type: z.enum(['INCOME', 'EXPENSE']).optional(),
    status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED']).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    accountId: accountId.optional(),
    categoryId: categoryId.optional(),
    envelopeId: envelopeId.optional(),
  })
  .strict();

export type CreateTransactionInput = z.output<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.output<typeof updateTransactionSchema>;
export type ListTransactionsInput = z.output<typeof listTransactionsSchema>;
