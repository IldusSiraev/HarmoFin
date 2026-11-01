import { z } from 'zod';

export const createTelegramLinkSchema = z.object({ consent: z.boolean() }).strict();

export type CreateTelegramLinkInput = z.infer<typeof createTelegramLinkSchema>;
