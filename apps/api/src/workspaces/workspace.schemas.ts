import { z } from 'zod';

export const createWorkspaceSchema = z
  .object({
    workspaceName: z.string().trim().min(1).max(120),
    budgetName: z.string().trim().min(1).max(120),
  })
  .strict();

export type CreateWorkspaceInput = z.output<typeof createWorkspaceSchema>;
