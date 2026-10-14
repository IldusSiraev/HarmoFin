import type { Prisma, WorkspaceMembershipRole } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { CycleSettings } from './cycle-period.domain.js';

const SETTINGS_SELECT = {
  cycleStartDay: true,
  periodBoundaryOffset: true,
  timezone: true,
} as const;

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const toIso = (value: Date) => value.toISOString().slice(0, 10);

export type StoredRevision = CycleSettings & { effectiveOn: string };

export type BudgetCycleState = CycleSettings & {
  planModelActivatedOn: string | null;
};

/** Reads and writes of cycle revisions. Every statement filters budget_id in the query itself. */
export class CycleRevisionRepository {
  async findMemberRole(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipRole | null> {
    const membership = await tx.workspaceMembership.findFirst({
      where: { workspaceId, userId, isActive: true },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  async budgetState(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    budgetId: string,
  ): Promise<BudgetCycleState | null> {
    const budget = await tx.budget.findFirst({
      where: { id: budgetId, workspaceId },
      select: { ...SETTINGS_SELECT, planModelActivatedOn: true },
    });
    if (!budget) return null;
    return {
      cycleStartDay: budget.cycleStartDay,
      periodBoundaryOffset: budget.periodBoundaryOffset,
      timezone: budget.timezone,
      planModelActivatedOn: budget.planModelActivatedOn ? toIso(budget.planModelActivatedOn) : null,
    };
  }

  /** Settings effective on `date`: latest revision not after it, else the Budget fields. */
  async settingsAt(
    tx: Prisma.TransactionClient,
    budgetId: string,
    date: string,
  ): Promise<CycleSettings | null> {
    const revision = await tx.budgetCycleRevision.findFirst({
      where: { budgetId, effectiveOn: { lte: toDate(date) } },
      orderBy: { effectiveOn: 'desc' },
      select: SETTINGS_SELECT,
    });
    if (revision) return revision;
    return tx.budget.findFirst({ where: { id: budgetId }, select: SETTINGS_SELECT });
  }

  async listRevisions(tx: Prisma.TransactionClient, budgetId: string): Promise<StoredRevision[]> {
    const rows = await tx.budgetCycleRevision.findMany({
      where: { budgetId },
      orderBy: { effectiveOn: 'asc' },
      select: { ...SETTINGS_SELECT, effectiveOn: true },
    });
    return rows.map((row) => ({ ...row, effectiveOn: toIso(row.effectiveOn) }));
  }

  /** First revision starting after `date` (used to clip a period at the next boundary change). */
  async nextEffectiveAfter(
    tx: Prisma.TransactionClient,
    budgetId: string,
    date: string,
  ): Promise<string | null> {
    const row = await tx.budgetCycleRevision.findFirst({
      where: { budgetId, effectiveOn: { gt: toDate(date) } },
      orderBy: { effectiveOn: 'asc' },
      select: { effectiveOn: true },
    });
    return row ? toIso(row.effectiveOn) : null;
  }

  /** Periods that fix the calendar: CONFIRMED target, or any assignment/movement reference. */
  async listConfirmedPeriods(
    tx: Prisma.TransactionClient,
    budgetId: string,
  ): Promise<Array<{ id: string; end: string }>> {
    const rows = await tx.envelopePeriod.findMany({
      where: {
        budgetId,
        OR: [
          { targetStatus: 'CONFIRMED' },
          { assignments: { some: {} } },
          { movementsAsSource: { some: {} } },
          { movementsAsDestination: { some: {} } },
        ],
      },
      orderBy: { id: 'asc' },
      select: { id: true, endsOn: true },
    });
    return rows.map((row) => ({ id: row.id, end: toIso(row.endsOn) }));
  }

  async listPeriodEnvelopes(
    tx: Prisma.TransactionClient,
    budgetId: string,
  ): Promise<Array<{ id: string; periodSlot: 'FIRST' | 'SECOND' }>> {
    const rows = await tx.envelope.findMany({
      where: { budgetId, archivedAt: null, periodSlot: { not: null } },
      orderBy: { id: 'asc' },
      select: { id: true, periodSlot: true },
    });
    return rows.flatMap((row) =>
      row.periodSlot ? [{ id: row.id, periodSlot: row.periodSlot }] : [],
    );
  }

  /**
   * Removes structural UNSET/DRAFT period rows that end on/after `from` and that nothing
   * references; CONFIRMED and referenced rows are never touched. Returns the removed ids.
   */
  async deleteUnconfirmedPeriodsEndingFrom(
    tx: Prisma.TransactionClient,
    budgetId: string,
    from: string,
  ): Promise<string[]> {
    const rows = await tx.envelopePeriod.findMany({
      where: {
        budgetId,
        endsOn: { gte: toDate(from) },
        targetStatus: { in: ['UNSET', 'DRAFT'] },
        assignments: { none: {} },
        movementsAsSource: { none: {} },
        movementsAsDestination: { none: {} },
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    await tx.envelopePeriod.deleteMany({
      where: {
        id: { in: ids },
        budgetId,
        targetStatus: { in: ['UNSET', 'DRAFT'] },
        assignments: { none: {} },
        movementsAsSource: { none: {} },
        movementsAsDestination: { none: {} },
      },
    });
    return ids;
  }

  async createRevision(
    tx: Prisma.TransactionClient,
    budgetId: string,
    actorUserId: string,
    revision: StoredRevision,
  ): Promise<string> {
    const id = createUuidV7();
    await tx.budgetCycleRevision.create({
      data: {
        id,
        budgetId,
        effectiveOn: toDate(revision.effectiveOn),
        cycleStartDay: revision.cycleStartDay,
        periodBoundaryOffset: revision.periodBoundaryOffset,
        timezone: revision.timezone,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
      },
    });
    return id;
  }

  async createAudit(
    tx: Prisma.TransactionClient,
    params: {
      budgetId: string;
      workspaceId: string;
      actorUserId: string;
      revisionId: string;
      requestId: string | undefined;
      newValues: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'budget_cycle_revision',
        entityId: params.revisionId,
        action: 'CREATED',
        source: 'API',
        requestId: params.requestId ?? null,
        newValues: params.newValues,
      },
    });
  }
}
