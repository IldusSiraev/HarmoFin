import { z } from 'zod';

import { consentListSchema } from '../legal/legal.schemas.js';

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const passwordSchema = z.string().min(10).max(128);
const optionalNameSchema = z.string().trim().min(1).max(120).optional();

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    workspaceName: optionalNameSchema,
    budgetName: optionalNameSchema,
    consents: consentListSchema.optional(),
    invitationToken: z.string().min(16).max(128).optional(),
  })
  .strict();

export const loginSchema = z.object({ email: emailSchema, password: z.string() }).strict();

export const recoveryRequestSchema = z.object({ email: emailSchema }).strict();

export const recoveryConfirmSchema = z
  .object({ token: z.string().min(1), password: passwordSchema })
  .strict();

export const changePasswordSchema = z
  .object({ currentPassword: z.string(), newPassword: passwordSchema })
  .strict();

export const updateProfileSchema = z
  .object({ displayName: z.string().trim().min(1).max(120) })
  .strict();

export type RegisterInput = z.output<typeof registerSchema>;
export type LoginInput = z.output<typeof loginSchema>;
export type RecoveryRequestInput = z.output<typeof recoveryRequestSchema>;
export type RecoveryConfirmInput = z.output<typeof recoveryConfirmSchema>;
export type ChangePasswordInput = z.output<typeof changePasswordSchema>;
export type UpdateProfileInput = z.output<typeof updateProfileSchema>;
