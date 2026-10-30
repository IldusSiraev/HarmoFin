import { describe, expect, it } from 'vitest';

import { FEED_KINDS, FEED_SOURCES, kindOf } from './feed-kinds.js';

describe('feed kinds', () => {
  it('maps every whitelisted audit pair to one kind', () => {
    expect(kindOf('transaction', 'CREATED')).toBe('TRANSACTION_CREATED');
    expect(kindOf('envelope-movement', 'CREATED')).toBe('ENVELOPE_MOVED');
    expect(kindOf('plan_occurrence', 'COMPLETED')).toBe('PLAN_PAID');
    expect(kindOf('workspace_invitation', 'ACCEPTED')).toBe('MEMBER_JOINED');
  });

  it('ignores pairs outside the whitelist', () => {
    expect(kindOf('transaction', 'CANCELLED')).toBeNull();
    expect(kindOf('transfer', 'UPDATED')).toBeNull();
    expect(kindOf('auth', 'LOGIN')).toBeNull();
    expect(kindOf('budget', 'UPDATED')).toBeNull();
  });

  it('has exactly one source per kind and no duplicate pairs', () => {
    expect(FEED_SOURCES.map((source) => source.kind).sort()).toEqual([...FEED_KINDS].sort());
    const pairs = FEED_SOURCES.map((source) => `${source.entityType}:${source.action}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
