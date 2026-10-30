import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from './feed-cursor.js';

const id = '0195f0a0-0000-7000-8000-000000000001';

describe('feed cursor', () => {
  it('round-trips createdAt and id', () => {
    const createdAt = new Date('2026-10-30T11:20:00.123Z');
    expect(decodeCursor(encodeCursor({ createdAt, id }))).toEqual({ createdAt, id });
  });

  it('rejects garbage, wrong version, bad date and bad id', () => {
    const raw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(raw({ v: 2, createdAt: '2026-10-30T00:00:00.000Z', id }))).toBeNull();
    expect(decodeCursor(raw({ v: 1, createdAt: 'yesterday', id }))).toBeNull();
    expect(decodeCursor(raw({ v: 1, createdAt: '2026-10-30T00:00:00.000Z', id: 'x' }))).toBeNull();
  });

  it('rejects base64url payloads that are valid JSON but not an object', () => {
    const raw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(decodeCursor(raw(null))).toBeNull();
    expect(decodeCursor(raw(42))).toBeNull();
    expect(decodeCursor(raw('cursor'))).toBeNull();
    expect(decodeCursor(raw([{ v: 1, createdAt: '2026-10-30T00:00:00.000Z', id }]))).toBeNull();
  });
});
