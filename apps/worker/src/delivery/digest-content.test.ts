import { describe, expect, it } from 'vitest';

import { dayLabel, personName } from './digest-content.js';
import { DIGEST_SOURCES, groupOf } from './digest-sources.js';

describe('digest sources', () => {
  it('covers the 16 feed pairs', () => {
    expect(DIGEST_SOURCES).toHaveLength(16);
    expect(groupOf('transaction', 'RESTORED')).toBe('operations');
    expect(groupOf('workspace_invitation', 'ACCEPTED')).toBe('family');
    expect(groupOf('notification', 'CREATED')).toBeNull();
  });
});

describe('personName', () => {
  it('labels people like the feed', () => {
    expect(personName('Алия', true)).toBe('Алия');
    expect(personName('Алия', false)).toBe('Алия (не в семье)');
    expect(personName(null, true)).toBe('Участник');
    expect(personName('  ', false)).toBe('Участник (не в семье)');
  });
});

describe('dayLabel', () => {
  it('formats the local day of the window start', () => {
    // 21:30 UTC on 30 Oct is already 31 Oct in Moscow.
    expect(dayLabel(new Date('2026-10-30T21:30:00.000Z'), 'Europe/Moscow')).toBe('31 октября');
    expect(dayLabel(new Date('2026-10-30T21:30:00.000Z'), 'UTC')).toBe('30 октября');
  });
});
