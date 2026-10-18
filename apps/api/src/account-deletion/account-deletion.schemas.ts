import { z } from 'zod';

export const requestDeletionSchema = z.object({ password: z.string().min(1).max(128) }).strict();

export const cancelDeletionSchema = z.object({ token: z.string().min(1).max(256) }).strict();

export type RequestDeletionInput = z.output<typeof requestDeletionSchema>;
export type CancelDeletionInput = z.output<typeof cancelDeletionSchema>;
