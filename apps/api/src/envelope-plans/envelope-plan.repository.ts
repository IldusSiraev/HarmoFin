import { type EnvelopeType, Prisma } from '@prisma/client';

import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { resourceNotFound } from '../common/reference-data/reference-data.errors.js';

export type EnvelopePlanRecord = {
  id: string;
  budgetId: string;
  name: string;
  envelopeType: EnvelopeType;
  targetAmountMinor: bigint | null;
  periodSlot: 'FIRST' | 'SECOND' | null;
  comment: string | null;
  displayOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
};

export type CreateEnvelopePlanParams = {
  budgetId: string;
  workspaceId: string;
  actorUserId: string;
  name: string;
  envelopeType: EnvelopeType;
  targetAmountMinor: bigint | null;
  periodSlot: 'FIRST' | 'SECOND' | null;
  comment: string | null;
  displayOrder: number;
  requestId?: string | undefined;
};

export type EnvelopePlanUpdateParams = {
  budgetId: string;
  workspaceId: string;
  actorUserId: string;
  envelopeId: string;
  oldName: string;
  newName?: string;
  oldPeriodSlot: 'FIRST' | 'SECOND' | null;
  newPeriodSlot?: 'FIRST' | 'SECOND' | null;
  requestId?: string | undefined;
};

export type ArchiveEnvelopeParams = {
  budgetId: string;
  workspaceId: string;
  actorUserId: string;
  envelopeId: string;
  archivedAt: Date;
  requestId?: string | undefined;
};

const ENVELOPE_SELECT = {
  id: true,
  budgetId: true,
  name: true,
  envelopeType: true,
  targetAmountMinor: true,
  periodSlot: true,
  comment: true,
  displayOrder: true,
  archivedAt: true,
  createdAt: true,
} as const;

function auditValues(record: EnvelopePlanRecord): Prisma.InputJsonValue {
  return {
    name: record.name,
    envelopeType: record.envelopeType,
    targetAmountMinor: record.targetAmountMinor?.toString() ?? null,
    periodSlot: record.periodSlot,
    comment: record.comment,
    archivedAt: record.archivedAt?.toISOString() ?? null,
  };
}

export class EnvelopePlanRepository {
  async lockBudget(tx: Prisma.TransactionClient, budgetId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "budgets"
      WHERE "id" = ${budgetId}::uuid
      FOR UPDATE
    `;
  }

  async lockEnvelope(tx: Prisma.TransactionClient, envelopeId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "envelopes"
      WHERE "id" = ${envelopeId}::uuid
      FOR UPDATE
    `;
  }

  async listActive(tx: Prisma.TransactionClient, budgetId: string): Promise<EnvelopePlanRecord[]> {
    return tx.envelope.findMany({
      where: { budgetId, archivedAt: null },
      select: ENVELOPE_SELECT,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findEnvelope(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
  ): Promise<EnvelopePlanRecord> {
    const envelope = await tx.envelope.findFirst({
      where: { id: envelopeId, budgetId },
      select: ENVELOPE_SELECT,
    });
    if (!envelope) {
      throw resourceNotFound();
    }
    return envelope;
  }

  async countActiveByType(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeType: EnvelopeType,
  ): Promise<number> {
    return tx.envelope.count({
      where: { budgetId, envelopeType, archivedAt: null },
    });
  }

  async findSlotOwner(
    tx: Prisma.TransactionClient,
    budgetId: string,
    periodSlot: 'FIRST' | 'SECOND',
    excludeEnvelopeId?: string,
  ): Promise<string | null> {
    const owner = await tx.envelope.findFirst({
      where: {
        budgetId,
        archivedAt: null,
        periodSlot,
        ...(excludeEnvelopeId ? { id: { not: excludeEnvelopeId } } : {}),
      },
      select: { id: true },
    });
    return owner?.id ?? null;
  }

  async nextDisplayOrder(tx: Prisma.TransactionClient, budgetId: string): Promise<number> {
    const count = await tx.envelope.count({ where: { budgetId, archivedAt: null } });
    return (count + 1) * 10;
  }

  async hasAssignments(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeId: string,
  ): Promise<boolean> {
    const count = await tx.envelopeAssignment.count({
      where: { budgetId, envelopeId },
    });
    return count > 0;
  }

  async createEnvelope(
    tx: Prisma.TransactionClient,
    params: CreateEnvelopePlanParams,
  ): Promise<EnvelopePlanRecord> {
    const envelope = await tx.envelope.create({
      data: {
        id: createUuidV7(),
        budgetId: params.budgetId,
        name: params.name,
        envelopeType: params.envelopeType,
        startingBalanceMinor: 0n,
        targetAmountMinor: params.targetAmountMinor,
        periodSlot: params.periodSlot,
        comment: params.comment,
        displayOrder: params.displayOrder,
      },
      select: ENVELOPE_SELECT,
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'envelope',
        entityId: envelope.id,
        action: 'CREATED',
        source: 'API',
        requestId: params.requestId ?? null,
        newValues: auditValues(envelope),
      },
    });
    return envelope;
  }

  async applyUpdate(
    tx: Prisma.TransactionClient,
    params: EnvelopePlanUpdateParams,
  ): Promise<EnvelopePlanRecord> {
    const data: Record<string, unknown> = {};
    if (params.newName !== undefined) data.name = params.newName;
    if (params.newPeriodSlot !== undefined) data.periodSlot = params.newPeriodSlot;

    const updated = await tx.envelope.update({
      where: { id: params.envelopeId },
      data,
      select: ENVELOPE_SELECT,
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'envelope',
        entityId: updated.id,
        action: 'UPDATED',
        source: 'API',
        requestId: params.requestId ?? null,
        oldValues: {
          name: params.oldName,
          periodSlot: params.oldPeriodSlot,
        },
        newValues: {
          name: params.newName ?? params.oldName,
          periodSlot: params.newPeriodSlot ?? params.oldPeriodSlot,
        },
      },
    });
    return updated;
  }

  async setArchived(
    tx: Prisma.TransactionClient,
    params: ArchiveEnvelopeParams,
  ): Promise<EnvelopePlanRecord> {
    const updated = await tx.envelope.update({
      where: { id: params.envelopeId },
      data: { archivedAt: params.archivedAt },
      select: ENVELOPE_SELECT,
    });
    await tx.auditEvent.create({
      data: {
        id: createUuidV7(),
        actorUserId: params.actorUserId,
        workspaceId: params.workspaceId,
        budgetId: params.budgetId,
        entityType: 'envelope',
        entityId: updated.id,
        action: 'ARCHIVED',
        source: 'API',
        requestId: params.requestId ?? null,
        oldValues: { archivedAt: null },
        newValues: { archivedAt: params.archivedAt.toISOString() },
      },
    });
    return updated;
  }
}
