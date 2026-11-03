import { z } from 'zod';

export const createTelegramLinkSchema = z.object({ consent: z.boolean() }).strict();

export type CreateTelegramLinkInput = z.infer<typeof createTelegramLinkSchema>;

export const updateTelegramCommandsSchema = z
  .object({ enabled: z.boolean(), consent: z.boolean().optional() })
  .strict();

export type UpdateTelegramCommandsInput = z.infer<typeof updateTelegramCommandsSchema>;
