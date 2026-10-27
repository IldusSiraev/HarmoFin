import type { Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';

export interface TransferredObjects {
  accounts: number;
  envelopes: number;
  plans: number;
}

type Owned = { id: string; budgetId: string };

/**
 * Moves every account, envelope and plan of `fromUserId` in the workspace's budgets to the family
 * creator, with one AuditEvent per object. Runs in the caller's transaction right after the
 * membership row is deactivated. Authorship of operations, allocations and movements stays.
 */
export async function transferMemberObjects(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    fromUserId: string;
    toUserId: string;
    actorUserId: string;
    requestId?: string | undefined;
    now: Date;
  },
): Promise<TransferredObjects> {
  const owned = { budget: { workspaceId: input.workspaceId }, ownerUserId: input.fromUserId };
  const select = { id: true, budgetId: true } as const;
  const [accounts, envelopes, plans] = await Promise.all([
    tx.account.findMany({ where: owned, select }),
    tx.envelope.findMany({ where: owned, select }),
    tx.regularPlan.findMany({
      where: { workspaceId: input.workspaceId, ownerUserId: input.fromUserId },
      select,
    }),
  ]);
  const data = { ownerUserId: input.toUserId };
  if (accounts.length > 0) {
    await tx.account.updateMany({ where: { id: { in: accounts.map((row) => row.id) } }, data });
  }
  if (envelopes.length > 0) {
    await tx.envelope.updateMany({ where: { id: { in: envelopes.map((row) => row.id) } }, data });
  }
  if (plans.length > 0) {
    await tx.regularPlan.updateMany({ where: { id: { in: plans.map((row) => row.id) } }, data });
  }
  const audit = (entityType: string) => (row: Owned) => ({
    id: createUuidV7(input.now),
    actorUserId: input.actorUserId,
    workspaceId: input.workspaceId,
    budgetId: row.budgetId,
    entityType,
    entityId: row.id,
    action: 'OWNER_TRANSFERRED',
    source: 'API',
    requestId: input.requestId ?? null,
    oldValues: { ownerUserId: input.fromUserId },
    newValues: { ownerUserId: input.toUserId },
  });
  const events = [
    ...accounts.map(audit('account')),
    ...envelopes.map(audit('envelope')),
    ...plans.map(audit('regular_plan')),
  ];
  if (events.length > 0) await tx.auditEvent.createMany({ data: events });
  return { accounts: accounts.length, envelopes: envelopes.length, plans: plans.length };
}
