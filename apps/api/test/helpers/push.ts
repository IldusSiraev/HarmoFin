import { randomBytes, randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

/** A syntactically valid public VAPID key (0x04 + 64 bytes, base64url). Not a real key pair. */
export const vapidPublicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString(
  'base64url',
);

/** Device keys in the shape the browser sends them. */
export const deviceKeys = {
  p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'),
  auth: Buffer.alloc(16, 2).toString('base64url'),
};

export const pushEndpoint = () => `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;

/** The session `FamilyTestApp.register()` created for the user. */
export async function currentSessionId(prisma: PrismaClient, userId: string): Promise<string> {
  const session = await prisma.session.findFirstOrThrow({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return session.id;
}

/** A second, already revoked session of the user (as after signing out on another device). */
export async function revokedSessionId(prisma: PrismaClient, userId: string): Promise<string> {
  const id = randomUUID();
  const future = new Date(Date.now() + 86_400_000);
  await prisma.session.create({
    data: {
      id,
      userId,
      tokenHash: randomBytes(32).toString('hex'),
      csrfTokenHash: randomBytes(32).toString('hex'),
      idleExpiresAt: future,
      absoluteExpiresAt: future,
      revokedAt: new Date(),
      revokedReason: 'LOGOUT',
    },
  });
  return id;
}

export async function addSubscription(
  prisma: PrismaClient,
  input: { userId: string; sessionId: string; endpoint?: string; applicationServerKey?: string },
): Promise<{ id: string; endpoint: string }> {
  const id = randomUUID();
  const endpoint = input.endpoint ?? pushEndpoint();
  await prisma.pushSubscription.create({
    data: {
      id,
      userId: input.userId,
      sessionId: input.sessionId,
      endpoint,
      p256dh: deviceKeys.p256dh,
      auth: deviceKeys.auth,
      applicationServerKey: input.applicationServerKey ?? vapidPublicKey,
      label: 'Chrome, Android',
    },
  });
  return { id, endpoint };
}

/** An overdue plan occurrence of the actor's budget and its in-app notification. */
export async function overdueNotification(
  prisma: PrismaClient,
  actor: { user: { id: string }; workspaceId: string; budgetId: string },
): Promise<{ notificationId: string; occurrenceId: string }> {
  const planId = randomUUID();
  const occurrenceId = randomUUID();
  await prisma.regularPlan.create({
    data: {
      id: planId,
      workspaceId: actor.workspaceId,
      budgetId: actor.budgetId,
      ownerUserId: actor.user.id,
      name: 'Ипотека',
      planType: 'EXPENSE',
      amountMinor: 4_500_000n,
      anchorOn: new Date('2026-10-01T00:00:00.000Z'),
      startOn: new Date('2026-10-01T00:00:00.000Z'),
      recurrence: 'MONTHLY',
      createdByUserId: actor.user.id,
      updatedByUserId: actor.user.id,
    },
  });
  await prisma.planOccurrence.create({
    data: {
      id: occurrenceId,
      workspaceId: actor.workspaceId,
      budgetId: actor.budgetId,
      planId,
      scheduledOn: new Date('2026-10-25T00:00:00.000Z'),
      planName: 'Ипотека',
      planType: 'EXPENSE',
      amountMinor: 4_500_000n,
      status: 'DUE',
    },
  });
  const notificationId = randomUUID();
  await prisma.notification.create({
    data: {
      id: notificationId,
      workspaceId: actor.workspaceId,
      budgetId: actor.budgetId,
      userId: actor.user.id,
      notificationType: 'PLAN_OVERDUE',
      occurrenceId,
      title: 'Просроченный план',
      body: 'План «Ипотека» просрочен с 2026-10-25.',
      actionPath: `/app/plans?occurrence=${occurrenceId}`,
      notificationKey: `occurrence:${occurrenceId}:PLAN_OVERDUE`,
    },
  });
  return { notificationId, occurrenceId };
}
