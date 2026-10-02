import { z } from 'zod';

const amount = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/)
  .refine((value) => Number(value) > 0, { message: 'Сумма должна быть больше нуля.' });

/**
 * New state of the old physical fact. `status: 'DELETED'` is a logical delete (history stays);
 * `status: 'CONFIRMED'` keeps the fact confirmed. Amount and deletion are mutually exclusive.
 */
const changeShape = {
  amount: amount.optional(),
  status: z.enum(['CONFIRMED', 'DELETED']).optional(),
};

function refineChange(
  value: { amount?: string | undefined; status?: 'CONFIRMED' | 'DELETED' | undefined },
  context: z.RefinementCtx,
): void {
  if (value.amount === undefined && value.status !== 'DELETED') {
    context.addIssue({
      code: 'custom',
      path: ['amount'],
      message: 'Укажите новую сумму или status DELETED.',
    });
  }
  if (value.amount !== undefined && value.status === 'DELETED') {
    context.addIssue({
      code: 'custom',
      path: ['status'],
      message: 'Удаление и новая сумма в одном запросе не сочетаются.',
    });
  }
}

export const legacyCorrectionPreviewSchema = z
  .object(changeShape)
  .strict()
  .superRefine(refineChange);

export const legacyCorrectionSchema = z
  .object({
    ...changeShape,
    previewHash: z.string().regex(/^[0-9a-f]{64}$/),
    allocationResolution: z.enum(['CANCEL', 'DELETE']).optional(),
  })
  .strict()
  .superRefine(refineChange);

export type LegacyCorrectionPreviewInput = z.output<typeof legacyCorrectionPreviewSchema>;
export type LegacyCorrectionInput = z.output<typeof legacyCorrectionSchema>;

export const budgetIdParamSchema = z.string().uuid();
export const transactionIdParamSchema = z.string().uuid();
