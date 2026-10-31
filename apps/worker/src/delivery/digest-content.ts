import type { PrismaClient } from '@prisma/client';

import { formatMinor } from '../mail/format.js';
import type { DigestContent, DigestGroup, DigestPerson } from '../mail/templates.js';
import { utcToLocal } from '../zoned-time.js';
import type { ClaimedDelivery } from './delivery.repository.js';
import { DIGEST_SOURCES, groupOf } from './digest-sources.js';

export function personName(displayName: string | null, isActiveMember: boolean): string {
  const name = displayName?.trim() || 'Участник';
  return isActiveMember ? name : `${name} (не в семье)`;
}

export function dayLabel(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
  }).format(instant);
}

/**
 * Digest body, built at send time from the budget's own rows only: counts of others' actions in the
 * window (same 16 pairs as the feed, never the recipient's own, never rows without an author) and
 * today's open plan payments. Returns null when there is nothing to tell.
 */
export async function loadDigestContent(
  prisma: PrismaClient,
  delivery: ClaimedDelivery,
  includeAmounts: boolean,
): Promise<DigestContent | null> {
  const start = delivery.digestPeriodStart;
  const end = delivery.digestPeriodEnd;
  if (!start || !end) return null;
  const budget = await prisma.budget.findFirst({
    where: { id: delivery.budgetId, workspaceId: delivery.workspaceId },
    select: { timezone: true, primaryCurrency: true },
  });
  if (!budget) return null;

  const rows = await prisma.auditEvent.groupBy({
    by: ['actorUserId', 'entityType', 'action'],
    where: {
      workspaceId: delivery.workspaceId,
      budgetId: delivery.budgetId,
      createdAt: { gte: start, lt: end },
      AND: [{ actorUserId: { not: null } }, { actorUserId: { not: delivery.userId } }],
      OR: DIGEST_SOURCES.map(({ entityType, action }) => ({ entityType, action })),
    },
    _count: { _all: true },
  });

  const counts = new Map<string, Partial<Record<DigestGroup, number>>>();
  for (const row of rows) {
    const group = groupOf(row.entityType, row.action);
    if (!group || !row.actorUserId) continue;
    const current = counts.get(row.actorUserId) ?? {};
    current[group] = (current[group] ?? 0) + row._count._all;
    counts.set(row.actorUserId, current);
  }
  const actorIds = [...counts.keys()];
  const [users, members] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, displayName: true },
    }),
    prisma.workspaceMembership.findMany({
      where: { workspaceId: delivery.workspaceId, userId: { in: actorIds }, isActive: true },
      select: { userId: true },
    }),
  ]);
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  const active = new Set(members.map((member) => member.userId));
  const total = (value: Partial<Record<DigestGroup, number>>) =>
    Object.values(value).reduce((sum, count) => sum + (count ?? 0), 0);
  const people: DigestPerson[] = actorIds
    .map((id) => ({
      name: personName(names.get(id) ?? null, active.has(id)),
      counts: counts.get(id)!,
    }))
    .sort((a, b) => total(b.counts) - total(a.counts) || a.name.localeCompare(b.name, 'ru'));

  const today = utcToLocal(end, budget.timezone).date;
  const occurrences = await prisma.planOccurrence.findMany({
    where: {
      workspaceId: delivery.workspaceId,
      budgetId: delivery.budgetId,
      scheduledOn: new Date(`${today}T00:00:00.000Z`),
      status: { in: ['PENDING', 'DUE'] },
    },
    select: { planName: true, amountMinor: true },
    orderBy: [{ planName: 'asc' }, { id: 'asc' }],
  });
  const payments = occurrences.map((occurrence) => ({
    name: occurrence.planName,
    amount: includeAmounts ? formatMinor(occurrence.amountMinor, budget.primaryCurrency) : null,
  }));

  if (people.length === 0 && payments.length === 0) return null;
  return {
    frequency: delivery.dedupeKey.startsWith('digest:WEEKLY:') ? 'WEEKLY' : 'DAILY',
    periodLabel: dayLabel(start, budget.timezone),
    people,
    payments,
  };
}
