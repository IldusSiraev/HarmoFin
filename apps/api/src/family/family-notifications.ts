import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { TransferredObjects } from './object-transfer.js';

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

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function transferSummary(counts: TransferredObjects): string {
  const parts: string[] = [];
  if (counts.accounts > 0) {
    parts.push(`${counts.accounts} ${plural(counts.accounts, 'счёт', 'счёта', 'счетов')}`);
  }
  if (counts.envelopes > 0) {
    parts.push(
      `${counts.envelopes} ${plural(counts.envelopes, 'конверт', 'конверта', 'конвертов')}`,
    );
  }
  if (counts.plans > 0) {
    parts.push(`${counts.plans} ${plural(counts.plans, 'план', 'плана', 'планов')}`);
  }
  return parts.join(', ');
}

export async function createObjectsTransferredNotification(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    budgetId: string;
    userId: string;
    memberName: string;
    counts: TransferredObjects;
    eventKey: string;
  },
): Promise<void> {
  await tx.notification.createMany({
    data: {
      id: createUuidV7(),
      workspaceId: input.workspaceId,
      budgetId: input.budgetId,
      userId: input.userId,
      notificationType: 'OBJECTS_TRANSFERRED',
      relatedEntityType: 'workspace_membership',
      title: `Вам переданы ${transferSummary(input.counts)}`,
      body: `Участник «${input.memberName}» больше не в семье. Счета, конверты и планы участника теперь ваши.`,
      actionPath: '/app/accounts',
      notificationKey: `access:OBJECTS_TRANSFERRED:${input.eventKey}`,
    },
    skipDuplicates: true,
  });
}
