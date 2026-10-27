import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FamilyTestApp, type FamilyActor } from './helpers/family-app.js';

const env = new FamilyTestApp();
let creator: FamilyActor;
let firstLeaverAccountId: string;
let firstLeaver: FamilyActor;

beforeAll(async () => {
  await env.start();
  creator = await env.register();
});

afterAll(async () => {
  await env.stop();
});

async function memberWithObjects() {
  const member = await env.join(creator, await env.register(), 'EDITOR');
  const suffix = member.user.id.slice(-6);
  const accountId = await env.createAccount(member, `Счёт ${suffix}`, '100');
  const envelopeId = await env.createEnvelope(member, `Конверт ${suffix}`);
  const expenseId = await env.record(member, { type: 'EXPENSE', accountId, amount: '10' });
  return { member, accountId, envelopeId, expenseId };
}

async function membershipId(userId: string): Promise<string> {
  const row = await env.prisma.workspaceMembership.findFirstOrThrow({
    where: { workspaceId: creator.workspaceId, userId, isActive: true },
    select: { id: true },
  });
  return row.id;
}

describe('objects of a member who leaves', () => {
  it('pass to the creator atomically with audit and one summary notification', async () => {
    const { member, accountId, envelopeId, expenseId } = await memberWithObjects();
    firstLeaver = member;
    firstLeaverAccountId = accountId;
    const response = await env.inject('POST', `/api/v1/workspaces/${creator.workspaceId}/leave`, member);
    expect(response.statusCode).toBe(204);

    expect((await env.prisma.account.findUniqueOrThrow({ where: { id: accountId } })).ownerUserId).toBe(
      creator.user.id,
    );
    expect(
      (await env.prisma.envelope.findUniqueOrThrow({ where: { id: envelopeId } })).ownerUserId,
    ).toBe(creator.user.id);
    expect(
      (await env.prisma.transaction.findUniqueOrThrow({ where: { id: expenseId } })).createdByUserId,
    ).toBe(member.user.id);

    const audits = await env.prisma.auditEvent.findMany({
      where: {
        workspaceId: creator.workspaceId,
        action: 'OWNER_TRANSFERRED',
        entityId: { in: [accountId, envelopeId] },
      },
    });
    expect(audits).toHaveLength(2);

    const notifications = await env.prisma.notification.findMany({
      where: {
        workspaceId: creator.workspaceId,
        userId: creator.user.id,
        notificationType: 'OBJECTS_TRANSFERRED',
      },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.title).toBe('Вам переданы 1 счёт, 1 конверт');
  });

  it('the same happens when the creator removes a member', async () => {
    const { member, accountId } = await memberWithObjects();
    const response = await env.inject(
      'DELETE',
      `/api/v1/workspaces/${creator.workspaceId}/members/${await membershipId(member.user.id)}`,
      creator,
    );
    expect(response.statusCode).toBe(204);
    expect((await env.prisma.account.findUniqueOrThrow({ where: { id: accountId } })).ownerUserId).toBe(
      creator.user.id,
    );
  });

  it('a member without objects produces no transfer notification', async () => {
    const member = await env.join(creator, await env.register(), 'VIEWER');
    const count = () =>
      env.prisma.notification.count({
        where: { userId: creator.user.id, notificationType: 'OBJECTS_TRANSFERRED' },
      });
    const before = await count();
    await env.inject('POST', `/api/v1/workspaces/${creator.workspaceId}/leave`, member);
    expect(await count()).toBe(before);
  });

  it('a re-activated member gets access back but not the objects', async () => {
    await env.prisma.workspaceMembership.updateMany({
      where: { workspaceId: creator.workspaceId, userId: firstLeaver.user.id },
      data: { isActive: true, removedAt: null, role: 'EDITOR' },
    });
    expect(
      (await env.prisma.account.findUniqueOrThrow({ where: { id: firstLeaverAccountId } })).ownerUserId,
    ).toBe(creator.user.id);
  });
});
