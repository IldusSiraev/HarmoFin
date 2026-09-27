import { Prisma, type EnvelopeType, type PeriodSlot } from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import {
  duplicateName,
  periodSlotAlreadyAssigned,
} from '../common/reference-data/reference-data.errors.js';
import type { ReferenceDataStatus } from '../common/reference-data/reference-data.types.js';
import { PrismaService } from '../database/prisma.service.js';

export interface EnvelopeRecord {
  id: string;
  budgetId: string;
  templateKey: string | null;
  name: string;
  envelopeType: EnvelopeType;
  currency: string;
  scale: number;
  startingBalanceMinor: bigint;
  monthlyPlannedAmountMinor: bigint | null;
  targetAmountMinor: bigint | null;
  targetDate: Date | null;
  periodSlot: PeriodSlot | null;
  displayOrder: number;
  comment: string | null;
  archivedAt: Date | null;
  currentBalanceMinor: bigint;
}

export interface EnvelopeCreateData {
  budgetId: string;
  name: string;
  envelopeType: EnvelopeType;
  periodSlot: PeriodSlot | null;
  currency: 'RUB';
  startingBalanceMinor: bigint;
  monthlyPlannedAmountMinor: bigint | null;
  targetAmountMinor: bigint | null;
  targetDate: Date | null;
  displayOrder: number;
  comment: string | null;
}

export interface EnvelopeUpdateData {
  name?: string;
  envelopeType?: EnvelopeType;
  startingBalanceMinor?: bigint;
  monthlyPlannedAmountMinor?: bigint | null;
  targetAmountMinor?: bigint | null;
  targetDate?: Date | null;
  periodSlot?: PeriodSlot | null;
  displayOrder?: number;
  comment?: string | null;
}

export interface EnvelopeBalanceTerms {
  startingBalanceMinor: bigint;
  incomeAllocatedMinor: bigint;
  expensesMinor: bigint;
  envelopeTransfersNetMinor: bigint;
  reallocationsNetMinor: bigint;
}

export interface EnvelopeReallocationRow {
  reallocationId: string;
  direction: 'IN' | 'OUT';
  otherEnvelopeId: string;
  otherEnvelopeName: string | null;
  amountMinor: bigint;
  occurredOn: string;
  comment: string | null;
}

export interface EnvelopeBalanceSummaryRecord {
  envelope: Omit<EnvelopeRecord, 'currentBalanceMinor'>;
  terms: EnvelopeBalanceTerms;
  reallocations: EnvelopeReallocationRow[];
}

export class EnvelopeRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balances = new FinancialBalanceRepository(),
  ) {}

  async findAccessibleWithRole(userId: string, budgetId: string) {
    return this.prisma.budget.findFirst({
      where: activeBudgetWhere(userId, budgetId),
      select: {
        id: true,
        workspaceId: true,
        allowNegativeBalance: true,
        workspace: {
          select: {
            memberships: { where: { userId, isActive: true }, select: { role: true }, take: 1 },
          },
        },
      },
    });
  }

  async list(
    userId: string,
    budgetId: string,
    status: ReferenceDataStatus,
  ): Promise<EnvelopeRecord[]> {
    return this.prisma.$transaction(async (tx) => {
      const envelopes = await tx.envelope.findMany({
        where: {
          budgetId,
          ...archiveWhere(status),
          budget: activeBudgetWhere(userId, budgetId),
        },
        select: envelopeSelect,
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      });
      return this.withCurrentBalances(tx, envelopes);
    });
  }

  async find(userId: string, budgetId: string, envelopeId: string): Promise<EnvelopeRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const envelope = await tx.envelope.findFirst({
        where: { id: envelopeId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
        select: envelopeSelect,
      });
      return envelope ? this.withCurrentBalance(tx, envelope) : null;
    });
  }

  async create(
    userId: string,
    input: EnvelopeCreateData,
    requestId?: string,
  ): Promise<EnvelopeRecord | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const budget = await tx.budget.findFirst({
          where: activeOwnerBudgetWhere(userId, input.budgetId),
          select: { workspaceId: true },
        });
        if (!budget) return null;
        if (input.periodSlot) {
          const slotOwner = await tx.envelope.findFirst({
            where: {
              budgetId: input.budgetId,
              archivedAt: null,
              periodSlot: input.periodSlot,
            },
            select: { id: true },
          });
          if (slotOwner) throw periodSlotAlreadyAssigned();
        }
        const envelope = await tx.envelope.create({
          data: { id: createUuidV7(), ...input },
          select: envelopeSelect,
        });
        await tx.auditEvent.create({
          data: {
            id: createUuidV7(),
            actorUserId: userId,
            workspaceId: budget.workspaceId,
            budgetId: input.budgetId,
            entityType: 'envelope',
            entityId: envelope.id,
            action: 'CREATED',
            source: 'API',
            requestId: requestId ?? null,
            newValues: auditValues(envelope),
          },
        });
        return this.withCurrentBalance(tx, envelope);
      });
    } catch (error) {
      throwDuplicateName(error);
    }
  }

  async update(
    userId: string,
    budgetId: string,
    envelopeId: string,
    input: EnvelopeUpdateData,
    requestId?: string,
  ): Promise<EnvelopeRecord | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.envelope.findFirst({
          where: {
            id: envelopeId,
            budgetId,
            archivedAt: null,
            budget: activeOwnerBudgetWhere(userId, budgetId),
          },
          select: envelopeSelect,
        });
        if (!current) return null;
        if (input.periodSlot) {
          const slotOwner = await tx.envelope.findFirst({
            where: {
              budgetId,
              archivedAt: null,
              periodSlot: input.periodSlot,
              id: { not: envelopeId },
            },
            select: { id: true },
          });
          if (slotOwner) throw periodSlotAlreadyAssigned();
        }
        const [budget, envelope] = await Promise.all([
          tx.budget.findUniqueOrThrow({ where: { id: budgetId }, select: { workspaceId: true } }),
          tx.envelope.update({ where: { id: envelopeId }, data: input, select: envelopeSelect }),
        ]);
        await tx.auditEvent.create({
          data: {
            id: createUuidV7(),
            actorUserId: userId,
            workspaceId: budget.workspaceId,
            budgetId,
            entityType: 'envelope',
            entityId: envelope.id,
            action: 'UPDATED',
            source: 'API',
            requestId: requestId ?? null,
            oldValues: auditValues(current),
            newValues: auditValues(envelope),
          },
        });
        return this.withCurrentBalance(tx, envelope);
      });
    } catch (error) {
      throwDuplicateName(error);
    }
  }

  async archive(
    userId: string,
    budgetId: string,
    envelopeId: string,
    requestId?: string,
  ): Promise<EnvelopeRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.envelope.findFirst({
        where: { id: envelopeId, budgetId, budget: activeOwnerBudgetWhere(userId, budgetId) },
        select: envelopeSelect,
      });
      if (!current) return null;
      if (current.archivedAt) return this.withCurrentBalance(tx, current);
      const [budget, envelope] = await Promise.all([
        tx.budget.findUniqueOrThrow({ where: { id: budgetId }, select: { workspaceId: true } }),
        tx.envelope.update({
          where: { id: envelopeId },
          data: { archivedAt: new Date() },
          select: envelopeSelect,
        }),
      ]);
      await tx.auditEvent.create({
        data: {
          id: createUuidV7(),
          actorUserId: userId,
          workspaceId: budget.workspaceId,
          budgetId,
          entityType: 'envelope',
          entityId: envelope.id,
          action: 'ARCHIVED',
          source: 'API',
          requestId: requestId ?? null,
          oldValues: auditValues(current),
          newValues: auditValues(envelope),
        },
      });
      return this.withCurrentBalance(tx, envelope);
    });
  }

  async balanceSummary(
    userId: string,
    budgetId: string,
    envelopeId: string,
  ): Promise<EnvelopeBalanceSummaryRecord | null> {
    const envelope = await this.prisma.envelope.findFirst({
      where: { id: envelopeId, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: envelopeSelect,
    });
    if (!envelope) return null;

    const [termsRow] = await this.prisma.$queryRaw<{
      startingBalanceMinor: bigint;
      incomeAllocatedMinor: bigint;
      expensesMinor: bigint;
      envelopeTransfersNetMinor: bigint;
      reallocationsNetMinor: bigint;
    }[]>`
      SELECT
        envelope."starting_balance_minor" AS "startingBalanceMinor",
        COALESCE((
          SELECT SUM(allocation."amount_minor")
          FROM "income_allocations" AS allocation
          WHERE allocation."budget_id" = ${budgetId}::uuid
            AND allocation."envelope_id" = ${envelopeId}::uuid
            AND allocation."status" = 'CONFIRMED'
        ), 0)::BIGINT AS "incomeAllocatedMinor",
        COALESCE((
          SELECT SUM(transaction."amount_minor")
          FROM "transactions" AS transaction
          WHERE transaction."budget_id" = ${budgetId}::uuid
            AND transaction."envelope_id" = ${envelopeId}::uuid
            AND transaction."transaction_type" = 'EXPENSE'
            AND transaction."status" = 'CONFIRMED'
        ), 0)::BIGINT AS "expensesMinor",
        COALESCE((
          SELECT SUM(part."amount_minor")
          FROM "transfer_parts" AS part
          INNER JOIN "transfers" AS transfer
            ON transfer."id" = part."transfer_id"
            AND transfer."budget_id" = part."budget_id"
          WHERE part."budget_id" = ${budgetId}::uuid
            AND transfer."budget_id" = ${budgetId}::uuid
            AND part."destination_envelope_id" = ${envelopeId}::uuid
            AND transfer."status" = 'CONFIRMED'
        ), 0)::BIGINT
        - COALESCE((
          SELECT SUM(part."amount_minor")
          FROM "transfer_parts" AS part
          INNER JOIN "transfers" AS transfer
            ON transfer."id" = part."transfer_id"
            AND transfer."budget_id" = part."budget_id"
          WHERE part."budget_id" = ${budgetId}::uuid
            AND transfer."budget_id" = ${budgetId}::uuid
            AND part."source_envelope_id" = ${envelopeId}::uuid
            AND transfer."status" = 'CONFIRMED'
        ), 0)::BIGINT AS "envelopeTransfersNetMinor",
        COALESCE((
          SELECT SUM(reallocation."amount_minor")
          FROM "envelope_reallocations" AS reallocation
          WHERE reallocation."budget_id" = ${budgetId}::uuid
            AND reallocation."destination_envelope_id" = ${envelopeId}::uuid
            AND reallocation."status" = 'CONFIRMED'
        ), 0)::BIGINT
        - COALESCE((
          SELECT SUM(reallocation."amount_minor")
          FROM "envelope_reallocations" AS reallocation
          WHERE reallocation."budget_id" = ${budgetId}::uuid
            AND reallocation."source_envelope_id" = ${envelopeId}::uuid
            AND reallocation."status" = 'CONFIRMED'
        ), 0)::BIGINT AS "reallocationsNetMinor"
      FROM "envelopes" AS envelope
      WHERE envelope."id" = ${envelopeId}::uuid
        AND envelope."budget_id" = ${budgetId}::uuid
    `;

    if (!termsRow) return null;

    const reallocations = await this.prisma.$queryRaw<
      Array<Omit<EnvelopeReallocationRow, 'direction'> & { direction: 'IN' | 'OUT' }>
    >`
      SELECT
        reallocation."id" AS "reallocationId",
        CASE
          WHEN reallocation."source_envelope_id" = ${envelopeId}::uuid THEN 'OUT'
          ELSE 'IN'
        END::text AS "direction",
        CASE
          WHEN reallocation."source_envelope_id" = ${envelopeId}::uuid
            THEN reallocation."destination_envelope_id"
          ELSE reallocation."source_envelope_id"
        END AS "otherEnvelopeId",
        other."name" AS "otherEnvelopeName",
        reallocation."amount_minor" AS "amountMinor",
        reallocation."occurred_on"::text AS "occurredOn",
        reallocation."comment"
      FROM "envelope_reallocations" AS reallocation
      LEFT JOIN "envelopes" AS other
        ON other."id" = CASE
          WHEN reallocation."source_envelope_id" = ${envelopeId}::uuid
            THEN reallocation."destination_envelope_id"
          ELSE reallocation."source_envelope_id"
        END
        AND other."budget_id" = reallocation."budget_id"
      WHERE reallocation."budget_id" = ${budgetId}::uuid
        AND reallocation."status" = 'CONFIRMED'
        AND (
          reallocation."source_envelope_id" = ${envelopeId}::uuid
          OR reallocation."destination_envelope_id" = ${envelopeId}::uuid
        )
      ORDER BY reallocation."occurred_on" DESC, reallocation."created_at" DESC
      LIMIT 100
    `;

    return {
      envelope,
      terms: {
        startingBalanceMinor: termsRow.startingBalanceMinor,
        incomeAllocatedMinor: termsRow.incomeAllocatedMinor,
        expensesMinor: termsRow.expensesMinor,
        envelopeTransfersNetMinor: termsRow.envelopeTransfersNetMinor,
        reallocationsNetMinor: termsRow.reallocationsNetMinor,
      },
      reallocations: reallocations.map((row) => ({
        reallocationId: row.reallocationId,
        direction: row.direction,
        otherEnvelopeId: row.otherEnvelopeId,
        otherEnvelopeName: row.otherEnvelopeName,
        amountMinor: row.amountMinor,
        occurredOn: row.occurredOn,
        comment: row.comment,
      })),
    };
  }

  private async withCurrentBalances(
    tx: Prisma.TransactionClient,
    envelopes: Array<Omit<EnvelopeRecord, 'currentBalanceMinor'>>,
  ): Promise<EnvelopeRecord[]> {
    return Promise.all(envelopes.map((envelope) => this.withCurrentBalance(tx, envelope)));
  }

  private async withCurrentBalance(
    tx: Prisma.TransactionClient,
    envelope: Omit<EnvelopeRecord, 'currentBalanceMinor'>,
  ): Promise<EnvelopeRecord> {
    return {
      ...envelope,
      currentBalanceMinor: await this.balances.envelopeBalance(tx, envelope.budgetId, envelope.id),
    };
  }
}

function activeBudgetWhere(userId: string, budgetId: string) {
  return {
    id: budgetId,
    status: 'ACTIVE' as const,
    workspace: {
      status: 'ACTIVE' as const,
      memberships: { some: { userId, isActive: true } },
    },
  };
}

function activeOwnerBudgetWhere(userId: string, budgetId: string) {
  return {
    ...activeBudgetWhere(userId, budgetId),
    workspace: {
      status: 'ACTIVE' as const,
      memberships: { some: { userId, isActive: true, role: 'OWNER' as const } },
    },
  };
}

function archiveWhere(status: ReferenceDataStatus) {
  if (status === 'active') return { archivedAt: null };
  if (status === 'archived') return { archivedAt: { not: null } };
  return {};
}

function auditValues(envelope: Omit<EnvelopeRecord, 'currentBalanceMinor'>) {
  return {
    name: envelope.name,
    envelopeType: envelope.envelopeType,
    currency: envelope.currency,
    scale: envelope.scale,
    startingBalanceMinor: envelope.startingBalanceMinor.toString(),
    monthlyPlannedAmountMinor: envelope.monthlyPlannedAmountMinor?.toString() ?? null,
    targetAmountMinor: envelope.targetAmountMinor?.toString() ?? null,
    targetDate: envelope.targetDate?.toISOString().slice(0, 10) ?? null,
    periodSlot: envelope.periodSlot,
    displayOrder: envelope.displayOrder,
    archivedAt: envelope.archivedAt?.toISOString() ?? null,
  };
}

function throwDuplicateName(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = Array.isArray(error.meta?.target)
      ? error.meta.target.join(',')
      : String(error.meta?.target ?? '');
    if (target.includes('envelopes_active_period_slot_key')) throw periodSlotAlreadyAssigned();
    throw duplicateName();
  }
  throw error;
}

const envelopeSelect = {
  id: true,
  budgetId: true,
  templateKey: true,
  name: true,
  envelopeType: true,
  currency: true,
  scale: true,
  startingBalanceMinor: true,
  monthlyPlannedAmountMinor: true,
  targetAmountMinor: true,
  targetDate: true,
  periodSlot: true,
  displayOrder: true,
  comment: true,
  archivedAt: true,
} as const;
