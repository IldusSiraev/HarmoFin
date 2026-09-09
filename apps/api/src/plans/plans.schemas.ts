import { z } from 'zod';

const amount = z.string().min(1).max(64);
const date = z.string().date();
const uuid = z.string().uuid();
const nullableUuid = uuid.nullable().optional();
const comment = z.string().trim().min(1).max(500).nullable().optional();
const recurrence = z.enum(['ONE_TIME', 'MONTHLY', 'EVERY_N_MONTHS', 'YEARLY']);

const planFields = {
  name: z.string().trim().min(1).max(120),
  planType: z.enum(['INCOME', 'EXPENSE', 'SAVINGS']),
  amount,
  anchorOn: date,
  startOn: date,
  endOn: date.nullable().optional(),
  recurrence,
  intervalMonths: z.number().int().min(2).max(120).nullable().optional(),
  accountId: nullableUuid,
  categoryId: nullableUuid,
  envelopeId: nullableUuid,
  comment,
  isActive: z.boolean().optional(),
};

export const createRegularPlanSchema = z
  .object(planFields)
  .strict()
  .superRefine((input, context) => {
    validatePlanShape(input, context);
  });

export const updateRegularPlanSchema = z
  .object({
    name: planFields.name.optional(),
    planType: planFields.planType.optional(),
    amount: amount.optional(),
    anchorOn: date.optional(),
    startOn: date.optional(),
    endOn: date.nullable().optional(),
    recurrence: recurrence.optional(),
    intervalMonths: z.number().int().min(2).max(120).nullable().optional(),
    accountId: nullableUuid,
    categoryId: nullableUuid,
    envelopeId: nullableUuid,
    comment,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Необходимо передать хотя бы одно поле для изменения.',
  });

export const listRegularPlansSchema = z
  .object({ status: z.enum(['active', 'inactive', 'all']).default('active') })
  .strict();

export const listPlanOccurrencesSchema = z
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

function validatePlanShape(
  input: z.output<typeof createRegularPlanSchema>,
  context: z.RefinementCtx,
) {
  if (input.endOn && input.endOn < input.startOn) {
    context.addIssue({
      code: 'custom',
      path: ['endOn'],
      message: 'Дата окончания не может быть раньше даты начала.',
    });
  }
  if (input.recurrence === 'ONE_TIME' && input.anchorOn !== input.startOn) {
    context.addIssue({
      code: 'custom',
      path: ['anchorOn'],
      message: 'Для разового плана опорная дата должна совпадать с датой начала.',
    });
  }
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
      message: 'Интервал в месяцах допустим только для периода «раз в несколько месяцев».',
    });
  }
  if (!input.categoryId) {
    context.addIssue({
      code: 'custom',
      path: ['categoryId'],
      message: 'Укажите категорию.',
    });
  }
  if (input.planType === 'INCOME' && input.envelopeId !== undefined && input.envelopeId !== null) {
    context.addIssue({
      code: 'custom',
      path: ['envelopeId'],
      message: 'План дохода не использует конверт.',
    });
  }
  if (input.planType !== 'INCOME' && !input.envelopeId) {
    context.addIssue({
      code: 'custom',
      path: ['envelopeId'],
      message: 'Укажите конверт.',
    });
  }
}

export type CreateRegularPlanInput = z.output<typeof createRegularPlanSchema>;
export type UpdateRegularPlanInput = z.output<typeof updateRegularPlanSchema>;
export type ListRegularPlansInput = z.output<typeof listRegularPlansSchema>;
export type ListPlanOccurrencesInput = z.output<typeof listPlanOccurrencesSchema>;
