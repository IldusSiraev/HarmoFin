import type { Prisma, PrismaClient } from '@prisma/client';

type Db = Prisma.TransactionClient | PrismaClient;

export type PersonRef = { userId: string; displayName: string | null; isActiveMember: boolean };

/** Display data of family members (current or former) of one workspace. */
export async function findPersonRefs(
  db: Db,
  workspaceId: string,
  userIds: string[],
): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const rows = await db.workspaceMembership.findMany({
    where: { workspaceId, userId: { in: unique } },
    select: { userId: true, isActive: true, user: { select: { displayName: true } } },
  });
  return new Map(
    rows.map((row) => [
      row.userId,
      { userId: row.userId, displayName: row.user.displayName, isActiveMember: row.isActive },
    ]),
  );
}

export function personRefOf(refs: Map<string, PersonRef>, userId: string): PersonRef {
  return refs.get(userId) ?? { userId, displayName: null, isActiveMember: false };
}
