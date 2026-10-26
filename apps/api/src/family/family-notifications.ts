import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

type AccessType = 'MEMBER_JOINED' | 'MEMBER_LEFT' | 'MEMBER_REMOVED';

const COPY: Record<AccessType, (name: string) => { title: string; body: string }> = {
  MEMBER_JOINED: (name) => ({
    title: `${name} присоединился к семье`,
    body: 'Новый участник видит бюджет семьи.',
  }),
  MEMBER_LEFT: (name) => ({
    title: `${name} вышел из семьи`,
    body: 'Участник больше не видит бюджет семьи.',
  }),
  MEMBER_REMOVED: (name) => ({
    title: `${name} удалён из семьи`,
    body: 'Участник больше не видит бюджет семьи.',
  }),
};

export async function createAccessNotification(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    budgetId: string;
    userId: string;
    type: AccessType;
    memberName: string;
    eventKey: string;
  },
): Promise<void> {
  const copy = COPY[input.type](input.memberName);
  await tx.notification.createMany({
    data: {
      id: createUuidV7(),
      workspaceId: input.workspaceId,
      budgetId: input.budgetId,
      userId: input.userId,
      notificationType: input.type,
      relatedEntityType: 'workspace_membership',
      title: copy.title,
      body: copy.body,
      actionPath: '/app/settings/family',
      notificationKey: `access:${input.type}:${input.eventKey}`,
    },
    skipDuplicates: true,
  });
}

/** A member who lost access must not keep open reminders of this family. */
export async function resolveUserNotifications(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
  now: Date,
): Promise<void> {
  await tx.notification.updateMany({
    where: { workspaceId, userId, resolvedAt: null },
    data: { resolvedAt: now },
  });
}
