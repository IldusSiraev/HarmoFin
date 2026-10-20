import { z } from 'zod';

const decimalAmount = z.string().min(1).max(64);
const periodSlot = z.enum(['FIRST', 'SECOND']);

export const createEnvelopeSchema = z
  .object({
    name: z.string().min(1).max(120),
    envelopeType: z.enum([
      'CURRENT_EXPENSES',
      'MANDATORY_EXPENSES',
      'SAVINGS_GOAL',
      'RESERVE',
      'CUSTOM',
    ]),
    periodSlot: periodSlot.optional(),
    targetAmountMinor: decimalAmount.optional(),
    comment: z.string().max(500).optional(),
  })
  .strict();

export type CreateEnvelopeInput = z.output<typeof createEnvelopeSchema>;

export const updateEnvelopeSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    periodSlot: periodSlot.optional(),
  })
  .strict();

export type UpdateEnvelopeInput = z.output<typeof updateEnvelopeSchema>;

const uuid = z.string().uuid();

export const createAssignmentSchema = z
  .object({
    envelopeId: uuid,
    incomeTransactionId: uuid.optional(),
    periodId: uuid.optional(),
    amount: decimalAmount,
    sourceKind: z.enum(['FREE', 'INCOME']),
  })
  .strict()
  .refine((value) => value.sourceKind !== 'INCOME' || value.incomeTransactionId !== undefined, {
    message: 'Для sourceKind=INCOME обязательно поле incomeTransactionId.',
    path: ['incomeTransactionId'],
  })
  .refine((value) => value.sourceKind !== 'FREE' || value.incomeTransactionId === undefined, {
    message: 'Поле incomeTransactionId допустимо только для sourceKind=INCOME.',
    path: ['incomeTransactionId'],
  });

export type CreateAssignmentInput = z.output<typeof createAssignmentSchema>;

const fundingRuleTypes = [
  'MANUAL',
  'SUM_OF_PLANS',
  'FIXED_PER_PERIOD',
  'SUGGESTED_FIXED',
  'PERCENT_OF_INCOME',
] as const;

type RuleFields = {
  type: (typeof fundingRuleTypes)[number];
  fixedAmount?: string | undefined;
  percentBasisPoints?: number | undefined;
};

function refineRuleFields(value: RuleFields, ctx: z.RefinementCtx): void {
  const fixedAllowed = value.type === 'FIXED_PER_PERIOD' || value.type === 'SUGGESTED_FIXED';
  if (fixedAllowed && value.fixedAmount === undefined) {
    ctx.addIssue({ code: 'custom', path: ['fixedAmount'], message: 'Укажите fixedAmount.' });
  }
  if (!fixedAllowed && value.fixedAmount !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['fixedAmount'],
      message: 'fixedAmount допустим только для FIXED_PER_PERIOD и SUGGESTED_FIXED.',
    });
  }
  const percent = value.type === 'PERCENT_OF_INCOME';
  if (percent && value.percentBasisPoints === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['percentBasisPoints'],
      message: 'Укажите percentBasisPoints.',
    });
  }
  if (!percent && value.percentBasisPoints !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['percentBasisPoints'],
      message: 'percentBasisPoints допустим только для PERCENT_OF_INCOME.',
    });
  }
}

export const putFundingRuleSchema = z
  .object({
    type: z.enum(fundingRuleTypes),
    priority: z.number().int().min(0).max(1_000_000),
    fixedAmount: decimalAmount.optional(),
    percentBasisPoints: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .superRefine(refineRuleFields);

const queueRuleSchema = z
  .object({
    envelopeId: uuid,
    type: z.enum(fundingRuleTypes),
    fixedAmount: decimalAmount.optional(),
    percentBasisPoints: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === 'MANUAL') {
      ctx.addIssue({
        code: 'custom',
        path: ['type'],
        message: 'Правило «Вручную» передаётся в outside, не в очереди.',
      });
    }
    refineRuleFields(value, ctx);
  });

const outsideRuleSchema = z.object({ envelopeId: uuid, type: z.literal('MANUAL') }).strict();

/** Batch save: queue order defines priority on the server; outside envelopes are MANUAL. */
export const putFundingRulesBatchSchema = z
  .object({
    queue: z.array(queueRuleSchema).max(200),
    outside: z.array(outsideRuleSchema).max(200),
    incomeSuggestion: z
      .object({
        enabled: z.boolean(),
        sourceCategoryId: uuid.nullable(),
        targetEnvelopeId: uuid.nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const list of ['queue', 'outside'] as const) {
      value[list].forEach((item, index) => {
        if (seen.has(item.envelopeId)) {
          ctx.addIssue({
            code: 'custom',
            path: [list, index, 'envelopeId'],
            message: 'Конверт указан больше одного раза.',
          });
        }
        seen.add(item.envelopeId);
      });
    }
  });

export type PutFundingRulesBatchInput = z.output<typeof putFundingRulesBatchSchema>;

export type PutFundingRuleInput = z.output<typeof putFundingRuleSchema>;

export const putPeriodTargetSchema = z.object({ target: decimalAmount.nullable() }).strict();

export type PutPeriodTargetInput = z.output<typeof putPeriodTargetSchema>;

export const envelopeHistorySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(256).optional(),
    status: z.enum(['CONFIRMED', 'DELETED']).optional(),
  })
  .strict();

export type EnvelopeHistoryQuery = z.output<typeof envelopeHistorySchema>;

export const uuidParamSchema = uuid;
