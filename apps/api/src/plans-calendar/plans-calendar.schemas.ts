import { z } from 'zod';

const uuid = z.string().uuid();

export const plansCalendarQuerySchema = z
  .object({
    ownerUserId: uuid.optional(),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Укажите месяц в формате ГГГГ-ММ.')
      .refine((value) => {
        const year = Number(value.slice(0, 4));
        return year >= 2000 && year <= 2100;
      }, 'Год должен быть от 2000 до 2100.'),
  })
  .strict();

export type PlansCalendarQuery = z.infer<typeof plansCalendarQuerySchema>;
