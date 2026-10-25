import { z } from 'zod';

const uuid = z.string().uuid();

/** Feed filters; the order is fixed: occurredOn desc, createdAt desc, id desc. */
export const listJournalSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(512).optional(),
    type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional(),
    status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED']).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    accountId: uuid.optional(),
    categoryId: uuid.optional(),
    envelopeId: uuid.optional(),
    createdByUserId: uuid.optional(),
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

export type ListJournalInput = z.output<typeof listJournalSchema>;
