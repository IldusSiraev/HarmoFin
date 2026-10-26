import { describe, expect, it } from 'vitest';

import {
  INVITATION_TTL_MS,
  buildInviteUrl,
  invitationExpiresAt,
  isExpired,
  maskEmail,
  normalizeEmail,
} from './invitation.domain.js';

describe('invitation domain', () => {
  it('normalizes email to trimmed lower case', () => {
    expect(normalizeEmail('  Alia.S@Mail.RU ')).toBe('alia.s@mail.ru');
  });

  it.each([
    ['alia@mail.ru', 'a***@mail.ru'],
    ['a@mail.ru', 'a***@mail.ru'],
    ['ildar.siraev@gmail.com', 'i***@gmail.com'],
  ])('masks %s as %s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });

  it('expires seven days after creation', () => {
    const now = new Date('2026-10-25T00:00:00.000Z');
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(invitationExpiresAt(now).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('treats the exact expiry moment as expired', () => {
    const expiresAt = new Date('2026-11-01T00:00:00.000Z');
    expect(isExpired(expiresAt, new Date('2026-10-31T23:59:59.999Z'))).toBe(false);
    expect(isExpired(expiresAt, expiresAt)).toBe(true);
  });

  it('puts the token into the fragment, never into the query', () => {
    const url = buildInviteUrl('https://harmofin.ru/', 'abc_DEF-123');
    expect(url).toBe('https://harmofin.ru/invite#token=abc_DEF-123');
    expect(new URL(url).search).toBe('');
  });
});
