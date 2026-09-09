import { z } from 'zod';

export const reportKeys = [
  'expenses-by-category',
  'expenses-by-period',
  'expenses-by-cycle',
  'incomes-by-cycle',
  'savings-reallocation-by-cycle',
  'net-cash-flow',
  'account-balances',
  'envelope-balances',
  'savings-goals',
  'plan-vs-actual',
] as const;

export const reportKeySchema = z.enum(reportKeys);

export const reportFiltersSchema = z
  .object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    accountId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    envelopeId: z.string().uuid().optional(),
    type: z.enum(['INCOME', 'EXPENSE']).optional(),
    currency: z.literal('RUB').optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.from && input.to) {
      if (input.from > input.to) {
        context.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'Дата окончания раньше даты начала.',
        });
      }
      const start = new Date(`${input.from}T00:00:00.000Z`);
      const end = new Date(`${input.to}T00:00:00.000Z`);
      if (end.getTime() - start.getTime() > 1_100 * 86_400_000) {
        context.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'Период отчёта не может превышать 36 месяцев.',
        });
      }
    }
  });

export type ReportKey = z.output<typeof reportKeySchema>;
export type ReportFilters = z.output<typeof reportFiltersSchema>;
