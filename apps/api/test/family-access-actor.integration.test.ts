import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findAccessActor } from '../src/common/policies/access-actor.repository.js';
import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let editor: FamilyActor;
let viewer: FamilyActor;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
  editor = await env.join(creator, await env.register(), 'EDITOR');
  viewer = await env.join(creator, await env.register(), 'VIEWER');
});

afterAll(async () => {
  await env.stop();
});

describe('findAccessActor', () => {
  it('returns role and creator flag for active members', async () => {
    await expect(findAccessActor(env.prisma, creator.workspaceId, creator.user.id)).resolves.toEqual({
      userId: creator.user.id,
      role: 'OWNER',
      isCreator: true,
    });
    await expect(findAccessActor(env.prisma, creator.workspaceId, editor.user.id)).resolves.toEqual({
      userId: editor.user.id,
      role: 'EDITOR',
      isCreator: false,
    });
  });

  it('returns null for a removed member and for a stranger', async () => {
    await env.prisma.workspaceMembership.updateMany({
      where: { workspaceId: creator.workspaceId, userId: viewer.user.id },
      data: { isActive: false, removedAt: new Date() },
    });
    await expect(findAccessActor(env.prisma, creator.workspaceId, viewer.user.id)).resolves.toBeNull();
    const stranger = await env.register();
    await expect(
      findAccessActor(env.prisma, creator.workspaceId, stranger.user.id),
    ).resolves.toBeNull();
  });
});

describe('FamilyTestApp smoke', () => {
  it('lets the creator create an account, an envelope, and record a confirmed income', async () => {
    const accountId = await env.createAccount(creator, 'Основной счёт');
    const envelopeId = await env.createEnvelope(creator, 'Еда');
    const transactionId = await env.record(creator, {
      type: 'INCOME',
      accountId,
      amount: '1000.00',
    });
    expect(accountId).toBeTruthy();
    expect(envelopeId).toBeTruthy();
    expect(transactionId).toBeTruthy();
  });
});
