import { z } from 'zod';

export const uuidParamSchema = z.string().uuid();

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const v2BudgetSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    allowNegativeAccountBalance: z.boolean().optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isValidTimezone, { message: 'Укажите корректный часовой пояс IANA.' })
      .optional(),
  })
  .strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Необходимо передать хотя бы одно поле для изменения.',
  });

export type V2BudgetSettingsInput = z.output<typeof v2BudgetSettingsSchema>;
