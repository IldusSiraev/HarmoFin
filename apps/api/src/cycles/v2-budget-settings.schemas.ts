import { z } from 'zod';

import { isValidTimezone } from '../common/timezone.js';

export const uuidParamSchema = z.string().uuid();

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
    timedEvents: z.enum(['KEEP_WALL_CLOCK', 'KEEP_INSTANT']).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.allowNegativeAccountBalance !== undefined ||
      input.timezone !== undefined,
    { message: 'Необходимо передать хотя бы одно поле для изменения.' },
  );

export type V2BudgetSettingsInput = z.output<typeof v2BudgetSettingsSchema>;
