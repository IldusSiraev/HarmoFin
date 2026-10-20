import { z } from 'zod';

const uuid = z.string().uuid();

export const occurredOnSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const directTransferSchema = z
  .object({
    sourceAccountId: uuid,
    destinationAccountId: uuid,
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .refine((v) => Number(v) > 0, { message: 'Сумма должна быть больше нуля.' }),
    occurredOn: occurredOnSchema,
    comment: z.string().max(500).optional(),
  })
  .strict();

export type CreateDirectTransferInput = z.infer<typeof directTransferSchema>;

export const directTransferListSchema = z
  .object({
    // UUID validation: a garbage cursor must be a 400, not a PrismaClientValidationError (500).
    cursor: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export type DirectTransferListQuery = z.infer<typeof directTransferListSchema>;

// Path parameter: a garbage id must be a 400, not a PrismaClientValidationError (500).
export const transferIdParamSchema = uuid;

/** Partial edit of a direct transfer; status changes only through delete/restore. */
export const updateDirectTransferSchema = z
  .object({
    sourceAccountId: uuid.optional(),
    destinationAccountId: uuid.optional(),
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .refine((v) => Number(v) > 0, { message: 'Сумма должна быть больше нуля.' })
      .optional(),
    occurredOn: occurredOnSchema.optional(),
    comment: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Укажите хотя бы одно поле.' });

export type UpdateDirectTransferInput = z.infer<typeof updateDirectTransferSchema>;
