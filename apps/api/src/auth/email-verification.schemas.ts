import { z } from 'zod';

export const emailVerificationConfirmSchema = z
  .object({ token: z.string().min(1).max(256) })
  .strict();

export type EmailVerificationConfirmInput = z.infer<typeof emailVerificationConfirmSchema>;
