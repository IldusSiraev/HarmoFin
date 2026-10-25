import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { createAccessNotification, resolveUserNotifications } from '../src/family/family-notifications.js';
import { FamilyRepository } from '../src/family/family.repository.js';
import { createPersonalWorkspace } from '../src/family/personal-workspace.js';
import { PrismaService } from '../src/database/prisma.service.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaService(databaseUrl);
const repository = new FamilyRepository(prisma);

const createdUserIds: string[] = [];
const createdWorkspaceIds: string[] = [];

async function createUser(email: string) {
  const id = randomUUID();
  await prisma.user.create({
    data: { id, email, passwordHash: 'x', status: 'ACTIVE' },
  });
  createdUserIds.push(id);
  return id;
}

describe('FamilyRepository, access notifications and personal workspace', () => {
  afterAll(async () => {
    for (const workspaceId of createdWorkspaceIds) {
      await prisma.notification.deleteMany({ where: { workspaceId } });
      await prisma.auditEvent.deleteMany({ where: { workspaceId } });
      await prisma.workspaceMembership.deleteMany({ where: { workspaceId } });
      await prisma.budget.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    }
    for (const userId of createdUserIds) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it('creates workspace, OWNER membership with lastSelectedAt, budget, and audit event', async () => {
    const userId = await createUser(`owner-${randomUUID()}@harmofin.test`);
    const now = new Date();

    const { workspace, budget } = await prisma.$transaction((tx) =>
      createPersonalWorkspace(tx, userId, now),
    );
    createdWorkspaceIds.push(workspace.id);

    const membership = await prisma.workspaceMembership.findFirst({
      where: { workspaceId: workspace.id, userId },
    });
    expect(membership).toMatchObject({ role: 'OWNER', isActive: true });
    expect(membership?.lastSelectedAt?.getTime()).toBe(now.getTime());

    const storedBudget = await prisma.budget.findFirst({
      where: { id: budget.id, workspaceId: workspace.id },
    });
    expect(storedBudget).not.toBeNull();

    const audit = await prisma.auditEvent.findFirst({
      where: { workspaceId: workspace.id, action: 'CREATED', entityType: 'workspace' },
    });
    expect(audit).not.toBeNull();
  });

  it('lists the creator first and excludes inactive memberships and other workspaces', async () => {
    const ownerId = await createUser(`owner-${randomUUID()}@harmofin.test`);
    const memberId = await createUser(`member-${randomUUID()}@harmofin.test`);
    const now = new Date();

    const { workspace } = await prisma.$transaction((tx) => createPersonalWorkspace(tx, ownerId, now));
    createdWorkspaceIds.push(workspace.id);

    await prisma.workspaceMembership.create({
      data: { id: randomUUID(), workspaceId: workspace.id, userId: memberId, role: 'EDITOR' },
    });
    const inactiveId = await createUser(`inactive-${randomUUID()}@harmofin.test`);
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        userId: inactiveId,
        role: 'VIEWER',
        isActive: false,
        removedAt: now,
      },
    });

    const { workspace: otherWorkspace } = await prisma.$transaction((tx) =>
      createPersonalWorkspace(tx, ownerId, now, undefined, {
        workspaceName: 'Другое пространство',
        budgetName: 'Другой бюджет',
      }),
    );
    createdWorkspaceIds.push(otherWorkspace.id);

    const members = await repository.listMembers(workspace.id);

    expect(members.map((member) => member.userId)).toEqual([ownerId, memberId]);
    expect(members[0]).toMatchObject({ role: 'OWNER' });
  });

  it('is idempotent per eventKey when creating an access notification', async () => {
    const userId = await createUser(`owner-${randomUUID()}@harmofin.test`);
    const now = new Date();
    const { workspace, budget } = await prisma.$transaction((tx) =>
      createPersonalWorkspace(tx, userId, now),
    );
    createdWorkspaceIds.push(workspace.id);
    const eventKey = randomUUID();

    await prisma.$transaction((tx) =>
      createAccessNotification(tx, {
        workspaceId: workspace.id,
        budgetId: budget.id,
        userId,
        type: 'MEMBER_JOINED',
        memberName: 'Тестовый участник',
        eventKey,
      }),
    );
    await prisma.$transaction((tx) =>
      createAccessNotification(tx, {
        workspaceId: workspace.id,
        budgetId: budget.id,
        userId,
        type: 'MEMBER_JOINED',
        memberName: 'Тестовый участник',
        eventKey,
      }),
    );

    const notifications = await prisma.notification.findMany({
      where: { workspaceId: workspace.id, userId, notificationType: 'MEMBER_JOINED' },
    });
    expect(notifications).toHaveLength(1);
  });

  it('resolves only that user notifications in that workspace', async () => {
    const userId = await createUser(`owner-${randomUUID()}@harmofin.test`);
    const otherId = await createUser(`other-${randomUUID()}@harmofin.test`);
    const now = new Date();
    const { workspace, budget } = await prisma.$transaction((tx) =>
      createPersonalWorkspace(tx, userId, now),
    );
    createdWorkspaceIds.push(workspace.id);
    await prisma.workspaceMembership.create({
      data: { id: randomUUID(), workspaceId: workspace.id, userId: otherId, role: 'EDITOR' },
    });

    await prisma.$transaction((tx) =>
      createAccessNotification(tx, {
        workspaceId: workspace.id,
        budgetId: budget.id,
        userId,
        type: 'MEMBER_LEFT',
        memberName: 'Тестовый участник',
        eventKey: randomUUID(),
      }),
    );
    await prisma.$transaction((tx) =>
      createAccessNotification(tx, {
        workspaceId: workspace.id,
        budgetId: budget.id,
        userId: otherId,
        type: 'MEMBER_LEFT',
        memberName: 'Другой участник',
        eventKey: randomUUID(),
      }),
    );

    await prisma.$transaction((tx) => resolveUserNotifications(tx, workspace.id, userId, now));

    const resolved = await prisma.notification.findFirst({ where: { workspaceId: workspace.id, userId } });
    const untouched = await prisma.notification.findFirst({
      where: { workspaceId: workspace.id, userId: otherId },
    });
    expect(resolved?.resolvedAt).not.toBeNull();
    expect(untouched?.resolvedAt).toBeNull();
  });
});
