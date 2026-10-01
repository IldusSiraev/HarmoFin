import { z } from 'zod';

const uuid = z.string().uuid();
const decimalAmount = z.string().min(1).max(64);

export const fundingPreviewSchema = z
  .object({
    sourceKind: z.enum(['INCOME', 'OPENING', 'FREE']),
    incomeTransactionId: uuid.optional(),
    overrides: z
      .array(
        z.object({ envelopeId: uuid, periodId: uuid.optional(), amount: decimalAmount }).strict(),
      )
      .max(100)
      .optional(),
    confirmPeriodTargets: z.array(uuid).max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.sourceKind === 'INCOME' && value.incomeTransactionId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['incomeTransactionId'],
        message: 'Для sourceKind=INCOME обязательно поле incomeTransactionId.',
      });
    }
    if (value.sourceKind !== 'INCOME' && value.incomeTransactionId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['incomeTransactionId'],
        message: 'Поле incomeTransactionId допустимо только для sourceKind=INCOME.',
      });
    }
  });

export type FundingPreviewRequestInput = z.output<typeof fundingPreviewSchema>;

export const putIncomeCategorySuggestionSchema = z
  .object({
    enabled: z.boolean(),
    sourceCategoryId: uuid.nullable(),
    targetEnvelopeId: uuid.nullable(),
  })
  .strict();

export type PutIncomeCategorySuggestionRequestInput = z.output<
  typeof putIncomeCategorySuggestionSchema
>;

export const fundingConfirmSchema = z
  .object({
    sourceKind: z.enum(['INCOME', 'OPENING', 'FREE']),
    incomeTransactionId: uuid.optional(),
    previewHash: z.string().regex(/^[0-9a-f]{64}$/),
    confirmPeriodTargets: z.array(uuid).max(100),
    lines: z
      .array(
        z.object({ envelopeId: uuid, periodId: uuid.optional(), amount: decimalAmount }).strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.sourceKind === 'INCOME' && value.incomeTransactionId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['incomeTransactionId'],
        message: 'Для sourceKind=INCOME обязательно поле incomeTransactionId.',
      });
    }
    if (value.sourceKind !== 'INCOME' && value.incomeTransactionId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['incomeTransactionId'],
        message: 'Поле incomeTransactionId допустимо только для sourceKind=INCOME.',
      });
    }
  });

export type FundingConfirmRequestInput = z.output<typeof fundingConfirmSchema>;

export const uuidParamSchema = uuid;
