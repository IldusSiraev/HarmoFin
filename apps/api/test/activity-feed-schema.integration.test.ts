import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createUuidV7 } from '../src/common/identifiers/uuid-v7.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let other: FamilyActor;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  other = await env.register();
});

afterAll(async () => {
  await env.stop();
});

const cursor = (actor: FamilyActor, budgetId = actor.budgetId) => ({
  id: createUuidV7(),
  workspaceId: actor.workspaceId,
  budgetId,
  userId: actor.user.id,
  seenAt: new Date('2026-10-30T10:00:00.000Z'),
});

describe('activity_feed_cursors', () => {
  it('stores one marker per budget and user', async () => {
    await env.prisma.activityFeedCursor.create({ data: cursor(creator) });
    await expect(env.prisma.activityFeedCursor.create({ data: cursor(creator) })).rejects.toThrow(
      /Unique constraint/,
    );
  });

  it('rejects a budget of another workspace', async () => {
    await expect(
      env.prisma.activityFeedCursor.create({ data: cursor(creator, other.budgetId) }),
    ).rejects.toThrow(/Foreign key constraint/);
  });
});
