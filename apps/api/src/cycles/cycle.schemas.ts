import { z } from 'zod';

export const cycleQuerySchema = z.object({ date: z.string().date().optional() }).strict();

export type CycleQueryInput = z.output<typeof cycleQuerySchema>;
