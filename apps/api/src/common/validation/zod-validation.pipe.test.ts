import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(
    z
      .object({
        email: z.string().email(),
        password: z.string().min(10),
      })
      .strict(),
  );

  it('maps invalid fields to a safe validation error', () => {
    expect(() => pipe.transform({ email: 'invalid', password: 'short', extra: true })).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'VALIDATION_FAILED',
          fieldErrors: expect.arrayContaining([
            expect.objectContaining({ field: 'email' }),
            expect.objectContaining({ field: 'password' }),
            expect.objectContaining({ field: 'extra' }),
          ]),
        }),
      }),
    );
  });
});
