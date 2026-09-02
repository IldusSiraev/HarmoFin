import { z } from 'zod';

export const createBudgetSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();

export const updateBudgetSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .strict()
  .refine((input) => input.name !== undefined || input.status !== undefined, {
    message: 'Необходимо передать хотя бы одно поле для изменения.',
  });

export type CreateBudgetInput = z.output<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.output<typeof updateBudgetSchema>;
