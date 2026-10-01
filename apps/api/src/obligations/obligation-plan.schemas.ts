import { z } from 'zod';

const uuid = z.string().uuid();
const date = z.string().date();
const amount = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Сумма — десятичная строка до 2 знаков.')
  .refine((value) => Number(value) > 0, { message: 'Сумма должна быть больше нуля.' });
const name = z.string().trim().min(1).max(120);
const comment = z.string().trim().min(1).max(500).nullable().optional();
const recurrence = z.enum(['ONE_TIME', 'MONTHLY', 'EVERY_N_MONTHS', 'YEARLY']);

export const uuidParamSchema = uuid;

export const createObligationPlanSchema = z
  .object({
    name,
    amount,
    scheduledOn: date,
    categoryId: uuid,
    recurrence,
    intervalMonths: z.number().int().min(2).max(120).nullable().optional(),
    endOn: date.nullable().optional(),
    comment,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.recurrence === 'EVERY_N_MONTHS') {
      if (!input.intervalMonths) {
        context.addIssue({
          code: 'custom',
          path: ['intervalMonths'],
          message: 'Укажите интервал в месяцах.',
        });
      }
    } else if (input.intervalMonths !== undefined && input.intervalMonths !== null) {
      context.addIssue({
        code: 'custom',
        path: ['intervalMonths'],
        message: 'Интервал допустим только для периода «раз в несколько месяцев».',
      });
    }
    if (input.recurrence === 'ONE_TIME' && input.endOn) {
      context.addIssue({
        code: 'custom',
        path: ['endOn'],
        message: 'Для разового платежа дата окончания не используется.',
      });
    }
    if (input.endOn && input.endOn < input.scheduledOn) {
      context.addIssue({
        code: 'custom',
        path: ['endOn'],
        message: 'Дата окончания не может быть раньше даты начала.',
      });
    }
  });

export const oneTimePaySchema = z
  .object({
    name,
    plannedAmount: amount,
    actualAmount: amount,
    occurredOn: date,
    accountId: uuid,
    categoryId: uuid,
    comment,
  })
  .strict();

export const updateObligationPlanSchema = z
  .object({
    name: name.optional(),
    amount: amount.optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
    applyToCurrentOpen: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.name === undefined &&
      input.amount === undefined &&
      input.status === undefined &&
      input.applyToCurrentOpen === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Необходимо передать хотя бы одно поле для изменения.',
      });
    }
    if (input.applyToCurrentOpen && input.amount === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['applyToCurrentOpen'],
        message: 'Подтверждение текущей суммы требует новой суммы.',
      });
    }
  });

export const listObligationPlansSchema = z
  .object({ status: z.enum(['active', 'archived', 'all']).default('active') })
  .strict();

export const listObligationOccurrencesSchema = z
  .object({
    planId: uuid.optional(),
    status: z.enum(['PENDING', 'DUE', 'SKIPPED', 'COMPLETED', 'CANCELLED']).optional(),
    from: date.optional(),
    to: date.optional(),
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

export type CreateObligationPlanInput = z.infer<typeof createObligationPlanSchema>;
export type OneTimePayInput = z.infer<typeof oneTimePaySchema>;
export type UpdateObligationPlanInput = z.infer<typeof updateObligationPlanSchema>;
export type ListObligationPlansInput = z.infer<typeof listObligationPlansSchema>;
export type ListObligationOccurrencesInput = z.infer<typeof listObligationOccurrencesSchema>;
