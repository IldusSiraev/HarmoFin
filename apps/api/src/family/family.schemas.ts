import { z } from 'zod';

export const uuidParamSchema = z.string().uuid();

export const invitableRoleSchema = z.enum(['EDITOR', 'VIEWER']);
export const changeRoleSchema = z.object({ role: invitableRoleSchema }).strict();
export const createInvitationSchema = z
  .object({ email: z.string().trim().email().max(320), role: invitableRoleSchema })
  .strict();
export const invitationTokenSchema = z.object({ token: z.string().min(16).max(128) }).strict();
export const acceptInvitationSchema = z
  .object({
    token: z.string().min(16).max(128),
    displayName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type ChangeRoleInput = z.output<typeof changeRoleSchema>;
export type CreateInvitationInput = z.output<typeof createInvitationSchema>;
export type InvitationTokenInput = z.output<typeof invitationTokenSchema>;
export type AcceptInvitationInput = z.output<typeof acceptInvitationSchema>;
