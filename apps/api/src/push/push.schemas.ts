import { z } from 'zod';

import { MAX_ENDPOINT_LENGTH, isValidAuthSecret, isValidP256dh } from './push-endpoint.js';

/** PushSubscription.toJSON() without expirationTime; the host is checked by the service (422). */
export const createPushSubscriptionSchema = z
  .object({
    endpoint: z.string().min(1).max(MAX_ENDPOINT_LENGTH),
    keys: z
      .object({
        p256dh: z.string().max(128).refine(isValidP256dh, { message: 'Неверный ключ устройства.' }),
        auth: z
          .string()
          .max(64)
          .refine(isValidAuthSecret, { message: 'Неверный ключ устройства.' }),
      })
      .strict(),
  })
  .strict();

export const updatePushSettingsSchema = z
  .object({
    enabled: z.boolean(),
    planOverdueEnabled: z.boolean(),
    calendarReminderEnabled: z.boolean(),
  })
  .strict();

export const pushSubscriptionIdSchema = z.string().uuid();

export type CreatePushSubscriptionInput = z.infer<typeof createPushSubscriptionSchema>;
export type UpdatePushSettingsInput = z.infer<typeof updatePushSettingsSchema>;
