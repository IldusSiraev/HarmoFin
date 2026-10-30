import { z } from 'zod';

import { decodeCursor } from './feed-cursor.js';

export const FEED_PAGE_LIMIT = 30;

export const activityUuidSchema = z.string().uuid();

export const activityFeedQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int('От 1 до 30.')
    .min(1, 'От 1 до 30.')
    .max(FEED_PAGE_LIMIT, 'От 1 до 30.')
    .default(FEED_PAGE_LIMIT),
  actorId: z.string().uuid('Некорректный участник.').optional(),
  cursor: z
    .string()
    .max(512, 'Некорректный курсор.')
    .refine((value) => decodeCursor(value) !== null, 'Некорректный курсор.')
    .optional(),
});

export type ActivityFeedQuery = z.infer<typeof activityFeedQuerySchema>;
