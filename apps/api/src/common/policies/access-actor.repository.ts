import type { Prisma, PrismaClient } from '@prisma/client';

import { forbidden } from '../reference-data/reference-data.errors.js';
import type { AccessActor } from './budget-access.policy.js';

type Db = Prisma.TransactionClient | PrismaClient;

/** Active membership of an active workspace, read in the caller's transaction. */
export async function findAccessActor(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<AccessActor | null> {
  const membership = await db.workspaceMembership.findFirst({
    where: { workspaceId, userId, isActive: true, workspace: { status: 'ACTIVE' } },
    select: { role: true, workspace: { select: { ownerId: true } } },
  });
  if (!membership) return null;
  return { userId, role: membership.role, isCreator: membership.workspace.ownerId === userId };
}

export async function requireAccessActor(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<AccessActor> {
  const actor = await findAccessActor(db, workspaceId, userId);
  if (!actor) throw forbidden();
  return actor;
}
