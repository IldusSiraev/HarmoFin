import { z } from 'zod';

export const listNotificationsSchema = z
  .object({
    state: z.enum(['unread', 'read', 'all']).default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export type ListNotificationsInput = z.output<typeof listNotificationsSchema>;
