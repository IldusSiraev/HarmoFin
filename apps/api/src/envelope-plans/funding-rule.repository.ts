import type { FundingRuleType, Prisma, TargetStatus } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import type { CycleSettings } from '../cycles/cycle-period.domain.js';

export type FundingRuleRecord = {
  id: string;
  budgetId: string;
  envelopeId: string;
  type: FundingRuleType;
  priority: number;
  fixedMinor: bigint | null;
  percentBasisPoints: number | null;
};

export type SaveFundingRuleParams = {
  budgetId: string;
  workspaceId: string;
  actorUserId: string;
  envelopeId: string;
  type: FundingRuleType;
  priority: number;
  fixedMinor: bigint | null;
  percentBasisPoints: number | null;
  requestId?: string | undefined;
};

export type PeriodActor = {
  workspaceId: string;
  userId: string;
  requestId?: string | undefined;
};

export type EnvelopePeriodRecord = {
  id: string;
  budgetId: string;
  envelopeId: string;
  startsOn: Date;
  endsOn: Date;
  targetMinor: bigint | null;
  targetStatus: TargetStatus;
  confirmedAt: Date | null;
};

export type OpenedPeriod = EnvelopePeriodRecord & { created: boolean };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RULE_SELECT = {
  id: true,
  budgetId: true,
  envelopeId: true,
  type: true,
  priority: true,
  fixedMinor: true,
  percentBasisPoints: true,
} as const;

const PERIOD_SELECT = {
  id: true,
  budgetId: true,
  envelopeId: true,
  startsOn: true,
  endsOn: true,
  targetMinor: true,
  targetStatus: true,
  confirmedAt: true,
} as const;

function ruleAudit(rule: FundingRuleRecord): Prisma.InputJsonValue {
  return {
    envelopeId: rule.envelopeId,
    type: rule.type,
    priority: rule.priority,
    fixedMinor: rule.fixedMinor?.toString() ?? null,
    percentBasisPoints: rule.percentBasisPoints,
  };
}

function targetAudit(period: {
  targetMinor: bigint | null;
  targetStatus: TargetStatus;
}): Prisma.InputJsonValue {
  return {
    targetMinor: period.targetMinor?.toString() ?? null,
    targetStatus: period.targetStatus,
  };
}

export class FundingRuleRepository {
  /** The single active rule of an envelope (one rule per envelope). Query filters budget_id. */
  async findRule(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
  ): Promise<FundingRuleRecord | null> {
    return tx.envelopeFundingRule.findFirst({
      where: { budgetId, envelopeId },
      select: RULE_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async saveRule(
    tx: Prisma.TransactionClient,
    params: SaveFundingRuleParams,
  ): Promise<FundingRuleRecord> {
    const existing = await this.findRule(tx, params.budgetId, params.envelopeId);
    const data = {
      type: params.type,
      priority: params.priority,
      fixedMinor: params.fixedMinor,
      percentBasisPoints: params.percentBasisPoints,
      updatedByUserId: params.actorUserId,
    };
    let rule: FundingRuleRecord;
    if (existing) {
      await tx.envelopeFundingRule.updateMany({
        where: { id: existing.id, budgetId: params.budgetId },
        data,
      });
      rule = { ...existing, ...params, id: existing.id };
    } else {
      rule = await tx.envelopeFundingRule.create({
        data: {
          id: createUuidV7(),
          budgetId: params.budgetId,
          envelopeId: params.envelopeId,
          createdByUserId: params.actorUserId,
          ...data,
        },
        select: RULE_SELECT,
      });
    }
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'envelope_funding_rule',
        entityId: rule.id,
        action: existing ? 'UPDATED' : 'CREATED',
        source: 'API',
        requestId: params.requestId ?? null,
        ...(existing ? { oldValues: ruleAudit(existing) } : {}),
        newValues: ruleAudit(rule),
      },
    });
    return rule;
  }

  /** Cycle settings effective on `date`: latest revision not after it, else budget settings. */
  async settingsAt(
    tx: Prisma.TransactionClient,
    budgetId: string,
    date: string,
  ): Promise<CycleSettings | null> {
    const revision = await tx.budgetCycleRevision.findFirst({
      where: { budgetId, effectiveOn: { lte: new Date(`${date}T00:00:00.000Z`) } },
      orderBy: { effectiveOn: 'desc' },
      select: { cycleStartDay: true, periodBoundaryOffset: true, timezone: true },
    });
    if (revision) return revision;
    return tx.budget.findUnique({
      where: { id: budgetId },
      select: { cycleStartDay: true, periodBoundaryOffset: true, timezone: true },
    });
  }

  async findPeriodByStart(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
    start: string,
  ): Promise<EnvelopePeriodRecord | null> {
    return tx.envelopePeriod.findFirst({
      where: { budgetId, envelopeId, startsOn: new Date(`${start}T00:00:00.000Z`) },
      select: PERIOD_SELECT,
    });
  }

  /**
   * Single shared creation point of a concrete envelope period. The row is created once:
   * a saved FIXED_PER_PERIOD rule yields a DRAFT suggested target, otherwise UNSET/null.
   * An existing row (snapshot) is returned untouched, so later rule changes never rewrite it.
   * The caller must hold the budget lock.
   */
  async getOrCreatePeriod(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
    start: string,
    end: string,
    actor: PeriodActor,
  ): Promise<OpenedPeriod> {
    const existing = await this.findPeriodByStart(tx, budgetId, envelopeId, start);
    if (existing) return { ...existing, created: false };

    const rule = await tx.envelopeFundingRule.findFirst({
      where: { budgetId, envelopeId, type: 'FIXED_PER_PERIOD', fixedMinor: { not: null } },
      select: { fixedMinor: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const targetMinor = rule?.fixedMinor ?? null;
    const targetStatus: TargetStatus = targetMinor === null ? 'UNSET' : 'DRAFT';
    const period = await tx.envelopePeriod.create({
      data: {
        id: createUuidV7(),
        budgetId,
        envelopeId,
        startsOn: new Date(`${start}T00:00:00.000Z`),
        endsOn: new Date(`${end}T00:00:00.000Z`),
        targetMinor,
        targetStatus,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
      select: PERIOD_SELECT,
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: actor.userId,
        workspaceId: actor.workspaceId,
        budgetId,
        entityType: 'envelope_period',
        entityId: period.id,
        action: 'CREATED',
        source: 'API',
        requestId: actor.requestId ?? null,
        newValues: {
          envelopeId,
          startsOn: start,
          endsOn: end,
          ...(targetAudit(period) as Record<string, unknown>),
        },
      },
    });
    return { ...period, created: true };
  }

  async findPeriodById(
    tx: Prisma.TransactionClient,
    budgetId: string,
    periodId: string,
  ): Promise<EnvelopePeriodRecord | null> {
    return tx.envelopePeriod.findFirst({
      where: { id: periodId, budgetId },
      select: PERIOD_SELECT,
    });
  }

  /** Row-locks one period of the budget; null when it is unknown or belongs to another budget. */
  async lockPeriod(
    tx: Prisma.TransactionClient,
    budgetId: string,
    periodId: string,
  ): Promise<EnvelopePeriodRecord | null> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "envelope_periods"
      WHERE "id" = ${periodId}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    if (locked.length === 0) return null;
    return tx.envelopePeriod.findFirst({
      where: { id: periodId, budgetId },
      select: PERIOD_SELECT,
    });
  }

  /**
   * Bulk DRAFT -> CONFIRMED for R04 (runs inside the caller's transaction, which must hold
   * the budget lock). Unknown, foreign-budget and non-DRAFT ids are silently ignored: the
   * WHERE clause filters by budget_id and target_status in SQL. Malformed (non-uuid) ids are
   * dropped before SQL so they cannot abort the caller's transaction. Returns the confirmed ids;
   * each gets its own audit event. Never touches funded, cash or assignments.
   */
  async confirmDrafts(
    tx: Prisma.TransactionClient,
    budgetId: string,
    periodIds: string[],
    userId: string,
    requestId?: string,
  ): Promise<string[]> {
    const ids = [...new Set(periodIds)].filter((id) => UUID_PATTERN.test(id));
    if (ids.length === 0) return [];
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "envelope_periods"
      WHERE "id" = ANY(${ids}::uuid[])
        AND "budget_id" = ${budgetId}::uuid
        AND "target_status"::text = 'DRAFT'
      ORDER BY "id"
      FOR UPDATE
    `;
    if (locked.length === 0) return [];
    const lockedIds = locked.map((row) => row.id);
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: budgetId },
      select: { workspaceId: true },
    });
    const periods = await tx.envelopePeriod.findMany({
      where: { id: { in: lockedIds }, budgetId, targetStatus: 'DRAFT' },
      select: PERIOD_SELECT,
      orderBy: { id: 'asc' },
    });
    const now = new Date();
    await tx.envelopePeriod.updateMany({
      where: { id: { in: periods.map((p) => p.id) }, budgetId, targetStatus: 'DRAFT' },
      data: {
        targetStatus: 'CONFIRMED',
        confirmedByUserId: userId,
        confirmedAt: now,
        updatedByUserId: userId,
      },
    });
    for (const period of periods) {
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: userId,
          workspaceId: budget.workspaceId,
          budgetId,
          entityType: 'envelope_period',
          entityId: period.id,
          action: 'UPDATED',
          source: 'API',
          requestId: requestId ?? null,
          oldValues: targetAudit(period),
          newValues: targetAudit({ ...period, targetStatus: 'CONFIRMED' }),
        },
      });
    }
    return periods.map((period) => period.id);
  }

  /** Owner rejects a DRAFT suggestion of one period: DRAFT -> UNSET/null, rule untouched. */
  async rejectDraft(
    tx: Prisma.TransactionClient,
    params: {
      budgetId: string;
      workspaceId: string;
      actorUserId: string;
      period: EnvelopePeriodRecord;
      requestId?: string | undefined;
    },
  ): Promise<EnvelopePeriodRecord> {
    const { period } = params;
    await tx.envelopePeriod.updateMany({
      where: { id: period.id, budgetId: params.budgetId, targetStatus: 'DRAFT' },
      data: {
        targetMinor: null,
        targetStatus: 'UNSET',
        confirmedByUserId: null,
        confirmedAt: null,
        updatedByUserId: params.actorUserId,
      },
    });
    const updated: EnvelopePeriodRecord = {
      ...period,
      targetMinor: null,
      targetStatus: 'UNSET',
      confirmedAt: null,
    };
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'envelope_period',
        entityId: period.id,
        action: 'UPDATED',
        source: 'API',
        requestId: params.requestId ?? null,
        oldValues: targetAudit(period),
        newValues: targetAudit(updated),
      },
    });
    return updated;
  }

  /** Explicit owner decision for a concrete period: CONFIRMED amount, or UNSET when null. */
  async applyTarget(
    tx: Prisma.TransactionClient,
    params: {
      budgetId: string;
      workspaceId: string;
      actorUserId: string;
      period: EnvelopePeriodRecord;
      targetMinor: bigint | null;
      requestId?: string | undefined;
    },
  ): Promise<EnvelopePeriodRecord> {
    const { period } = params;
    const nextStatus: TargetStatus = params.targetMinor === null ? 'UNSET' : 'CONFIRMED';
    if (period.targetMinor === params.targetMinor && period.targetStatus === nextStatus) {
      return period;
    }
    const now = new Date();
    await tx.envelopePeriod.updateMany({
      where: { id: period.id, budgetId: params.budgetId },
      data: {
        targetMinor: params.targetMinor,
        targetStatus: nextStatus,
        confirmedByUserId: nextStatus === 'CONFIRMED' ? params.actorUserId : null,
        confirmedAt: nextStatus === 'CONFIRMED' ? now : null,
        updatedByUserId: params.actorUserId,
      },
    });
    const updated: EnvelopePeriodRecord = {
      ...period,
      targetMinor: params.targetMinor,
      targetStatus: nextStatus,
      confirmedAt: nextStatus === 'CONFIRMED' ? now : null,
    };
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'envelope_period',
        entityId: period.id,
        action: 'UPDATED',
        source: 'API',
        requestId: params.requestId ?? null,
        oldValues: targetAudit(period),
        newValues: targetAudit(updated),
      },
    });
    return updated;
  }
}
