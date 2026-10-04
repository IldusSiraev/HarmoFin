import { z } from 'zod';

export const uuidParamSchema = z.string().uuid();

const actionSchema = z.enum(['CREATE', 'ADOPT', 'SKIP']);
const nameSchema = z.string().trim().min(1).max(120);
const decimalAmount = z.string().min(1).max(64);

const periodChoice = z
  .object({
    role: z.enum(['FIRST', 'SECOND']),
    action: actionSchema,
    name: nameSchema.optional(),
    target: decimalAmount.nullable().optional(),
    ruleChoice: z.enum(['SUGGESTED', 'MANUAL']).optional(),
  })
  .strict();

export const templateApplySchema = z
  .object({
    previewHash: z.string().regex(/^[0-9a-f]{64}$/),
    cycle: z
      .object({
        startDay: z.number().int().min(1).max(28),
        boundaryOffset: z.number().int().min(1).max(27),
      })
      .strict()
      .optional(),
    periods: z.array(periodChoice).length(2),
    mandatory: z
      .object({
        action: actionSchema,
        name: nameSchema.optional(),
        ruleChoice: z.enum(['SUGGESTED', 'MANUAL']).optional(),
      })
      .strict(),
    savings: z
      .array(
        z
          .object({
            name: nameSchema,
            requestedContribution: decimalAmount.nullable().optional(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    const roles = new Set(value.periods.map((item) => item.role));
    if (roles.size !== 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['periods'],
        message: 'Нужна ровно одна запись для FIRST и одна для SECOND.',
      });
    }
    const names = value.savings.map((item) => item.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['savings'],
        message: 'Накопления не должны повторяться.',
      });
    }
  });

export type TemplateApplyInput = z.output<typeof templateApplySchema>;
