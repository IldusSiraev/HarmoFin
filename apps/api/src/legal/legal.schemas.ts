import { z } from 'zod';

export const consentInputSchema = z
  .object({
    document: z.enum(['TERMS', 'PRIVACY_POLICY', 'PD_CONSENT']),
    version: z.string().min(1).max(32),
  })
  .strict();

export const consentListSchema = z.array(consentInputSchema).min(1).max(10);

export const acceptConsentsSchema = z.object({ consents: consentListSchema }).strict();

export type AcceptConsentsInput = z.output<typeof acceptConsentsSchema>;
