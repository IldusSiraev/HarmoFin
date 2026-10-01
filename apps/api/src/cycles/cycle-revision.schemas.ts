import { z } from 'zod';

export const uuidParamSchema = z.string().uuid();

export const cycleChangePreviewSchema = z
  .object({
    cycleStartDay: z.number().int().min(1).max(28),
    periodBoundaryOffset: z.number().int().min(1).max(27),
  })
  .strict();

export const cycleChangeConfirmSchema = z
  .object({
    cycleStartDay: z.number().int().min(1).max(28),
    periodBoundaryOffset: z.number().int().min(1).max(27),
    previewHash: z.string().regex(/^[0-9a-f]{64}$/),
    transitionTargets: z
      .array(
        z
          .object({
            periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            target: z.string().min(1).max(64).nullable().optional(),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();

export type CycleChangePreviewInput = z.output<typeof cycleChangePreviewSchema>;
export type CycleChangeConfirmInput = z.output<typeof cycleChangeConfirmSchema>;
