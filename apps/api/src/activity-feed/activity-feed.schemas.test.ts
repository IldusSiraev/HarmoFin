import { describe, expect, it } from 'vitest';

import { encodeCursor } from './feed-cursor.js';
import { activityFeedQuerySchema } from './activity-feed.schemas.js';

describe('activityFeedQuerySchema', () => {
  it('defaults limit to 30 and coerces strings', () => {
    expect(activityFeedQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(activityFeedQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5 });
  });

  it('rejects limits outside 1..30, a bad actor id and a bad cursor', () => {
    expect(activityFeedQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(activityFeedQuerySchema.safeParse({ limit: '31' }).success).toBe(false);
    expect(activityFeedQuerySchema.safeParse({ actorId: 'me' }).success).toBe(false);
    expect(activityFeedQuerySchema.safeParse({ cursor: 'garbage' }).success).toBe(false);
  });

  it('accepts a cursor produced by the server', () => {
    const cursor = encodeCursor({
      createdAt: new Date('2026-10-30T10:00:00.000Z'),
      id: '0195f0a0-0000-7000-8000-000000000001',
    });
    expect(activityFeedQuerySchema.parse({ cursor }).cursor).toBe(cursor);
  });
});
