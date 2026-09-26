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

export type PlanShapeInput = {
  planType: 'INCOME' | 'EXPENSE' | 'SAVINGS';
  startOn: string;
  endOn?: string | null | undefined;
  recurrence: 'ONE_TIME' | 'MONTHLY' | 'EVERY_N_MONTHS' | 'YEARLY';
  intervalMonths?: number | null | undefined;
  anchorOn: string;
  categoryId?: string | null | undefined;
  envelopeId?: string | null | undefined;
};

export type PlanShapeIssue = { path: string; message: string };

export function collectPlanShapeIssues(input: PlanShapeInput): PlanShapeIssue[] {
  const issues: PlanShapeIssue[] = [];
  if (input.endOn && input.endOn < input.startOn) {
    issues.push({
      path: 'endOn',
      message: 'Дата окончания не может быть раньше даты начала.',
    });
  }
  if (input.recurrence === 'ONE_TIME' && input.anchorOn !== input.startOn) {
    issues.push({
      path: 'anchorOn',
      message: 'Для разового плана опорная дата должна совпадать с датой начала.',
    });
  }
  if (input.recurrence === 'EVERY_N_MONTHS') {
    if (!input.intervalMonths) {
      issues.push({ path: 'intervalMonths', message: 'Укажите интервал в месяцах.' });
    }
  } else if (input.intervalMonths !== undefined && input.intervalMonths !== null) {
    issues.push({
      path: 'intervalMonths',
      message: 'Интервал в месяцах допустим только для периода «раз в несколько месяцев».',
    });
  }
  if (!input.categoryId) {
    issues.push({ path: 'categoryId', message: 'Укажите категорию.' });
  }
  if (input.planType === 'INCOME' && input.envelopeId !== undefined && input.envelopeId !== null) {
    issues.push({ path: 'envelopeId', message: 'План дохода не использует конверт.' });
  }
  if (input.planType !== 'INCOME' && !input.envelopeId) {
    issues.push({ path: 'envelopeId', message: 'Укажите конверт.' });
  }
  return issues;
}

function validatePlanShape(
  input: z.output<typeof createRegularPlanSchema>,
  context: z.RefinementCtx,
) {
  for (const issue of collectPlanShapeIssues(input)) {
    context.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  }
}

export type CreateRegularPlanInput = z.output<typeof createRegularPlanSchema>;
export type UpdateRegularPlanInput = z.output<typeof updateRegularPlanSchema>;
export type ListRegularPlansInput = z.output<typeof listRegularPlansSchema>;
export type ListPlanOccurrencesInput = z.output<typeof listPlanOccurrencesSchema>;
