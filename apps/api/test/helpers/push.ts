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
