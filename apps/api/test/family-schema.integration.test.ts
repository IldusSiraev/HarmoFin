import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const createdUserIds: string[] = [];

async function seedWorkspace() {
  const userId = randomUUID();
  createdUserIds.push(userId);
  await prisma.user.create({
    data: { id: userId, email: `schema-${userId}@harmofin.test`, passwordHash: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: { id: randomUUID(), ownerId: userId, name: 'Семья' },
  });
  return { userId, workspaceId: workspace.id };
}

function invitationData(workspaceId: string, invitedByUserId: string, email: string) {
  return {
    id: randomUUID(),
    workspaceId,
    email,
    role: 'EDITOR' as const,
    tokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
    expiresAt: new Date(Date.now() + 86_400_000),
    invitedByUserId,
  };
}

describe('family access schema', () => {
  afterAll(async () => {
    for (const userId of createdUserIds) {
      const workspaces = await prisma.workspace.findMany({ where: { ownerId: userId } });
      for (const workspace of workspaces) {
        await prisma.workspaceInvitation.deleteMany({ where: { workspaceId: workspace.id } });
        await prisma.workspaceMembership.deleteMany({ where: { workspaceId: workspace.id } });
        await prisma.workspace.delete({ where: { id: workspace.id } });
      }
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it('allows only one pending invitation per workspace and email', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    await prisma.workspaceInvitation.create({
      data: invitationData(workspaceId, userId, 'a@mail.ru'),
    });
    await expect(
      prisma.workspaceInvitation.create({ data: invitationData(workspaceId, userId, 'a@mail.ru') }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a new pending invitation after the previous one is revoked', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const first = await prisma.workspaceInvitation.create({
      data: invitationData(workspaceId, userId, 'b@mail.ru'),
    });
    await prisma.workspaceInvitation.update({
      where: { id: first.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await expect(
      prisma.workspaceInvitation.create({ data: invitationData(workspaceId, userId, 'b@mail.ru') }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('rejects an OWNER invitation at the database level', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    await expect(
      prisma.workspaceInvitation.create({
        data: { ...invitationData(workspaceId, userId, 'c@mail.ru'), role: 'OWNER' },
      }),
    ).rejects.toThrow(/workspace_invitations_role_check/);
  });

  it('stores lastSelectedAt on memberships', async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const selectedAt = new Date('2026-10-25T10:00:00.000Z');
    const membership = await prisma.workspaceMembership.create({
      data: { id: randomUUID(), workspaceId, userId, role: 'OWNER', lastSelectedAt: selectedAt },
    });
    expect(membership.lastSelectedAt?.toISOString()).toBe(selectedAt.toISOString());
  });
});
