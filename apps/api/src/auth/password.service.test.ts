import { describe, expect, it } from 'vitest';

import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('requires passwords from 10 through 128 characters without trimming input', () => {
    expect(() => service.assertValid('123456789')).toThrow(/10/);
    expect(() => service.assertValid('1234567890')).not.toThrow();
    expect(() => service.assertValid('a'.repeat(129))).toThrow(/128/);
    expect(() => service.assertValid(' 123456789 ')).not.toThrow();
  });

  it('hashes with Argon2id and verifies correct passwords only', async () => {
    const firstHash = await service.hash('password-123');
    const secondHash = await service.hash('password-123');

    expect(firstHash).toContain('$argon2id$');
    expect(firstHash).not.toBe(secondHash);
    await expect(service.verify(firstHash, 'password-123')).resolves.toBe(true);
    await expect(service.verify(firstHash, 'wrong-password')).resolves.toBe(false);
  });
});
