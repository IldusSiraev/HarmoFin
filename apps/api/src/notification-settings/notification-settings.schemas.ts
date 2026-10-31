import { z } from 'zod';

export const updateEmailSettingsSchema = z
  .object({
    enabled: z.boolean(),
    urgentEnabled: z.boolean(),
    digestFrequency: z.enum(['OFF', 'DAILY', 'WEEKLY']),
    includeAmounts: z.boolean(),
    amountsConsent: z.boolean().optional(),
  })
  .strict();

export const unsubscribeSchema = z.object({ token: z.string().min(1).max(256) }).strict();

export type UpdateEmailSettingsInput = z.infer<typeof updateEmailSettingsSchema>;
export type UnsubscribeInput = z.infer<typeof unsubscribeSchema>;
