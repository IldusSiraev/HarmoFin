import { describe, expect, it } from 'vitest';

import { maskEmail } from './mask-email.js';

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('anna.petrova@example.test')).toBe('a***@example.test');
  });

  it('masks a one-letter local part', () => {
    expect(maskEmail('a@example.test')).toBe('a***@example.test');
  });
});
