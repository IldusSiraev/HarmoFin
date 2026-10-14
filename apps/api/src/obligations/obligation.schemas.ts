import { z } from 'zod';

const uuid = z.string().uuid();

export const uuidParamSchema = uuid;

export const obligationPaySchema = z
  .object({
    accountId: uuid,
    categoryId: uuid,
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .refine((v) => Number(v) > 0, { message: 'Сумма должна быть больше нуля.' }),
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    willPayMore: z.boolean(),
  })
  .strict();

export type ObligationPayBodyInput = z.infer<typeof obligationPaySchema>;
