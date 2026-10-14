import { z } from 'zod';

export const createBudgetSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();

export type CreateBudgetInput = z.output<typeof createBudgetSchema>;
