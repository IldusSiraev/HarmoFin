import { z } from 'zod';

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimezone, { message: 'Укажите корректный часовой пояс IANA.' });

export const createBudgetSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();

export const updateBudgetSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    timezone: timezoneSchema.optional(),
    cycleStartDay: z.number().int().min(1).max(28).optional(),
    periodBoundaryOffset: z.number().int().min(1).max(27).optional(),
    allowNegativeBalance: z.boolean().optional(),
    incomeAllocationRuleEnabled: z.boolean().optional(),
    incomeAllocationSourceCategoryId: z.string().uuid().optional(),
    incomeAllocationTargetEnvelopeId: z.string().uuid().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Необходимо передать хотя бы одно поле для изменения.',
  });

export type CreateBudgetInput = z.output<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.output<typeof updateBudgetSchema>;

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
