import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { RolePolicy } from '../common/policies/role-policy.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import {
  forbidden,
  periodSlotAlreadyAssigned,
} from '../common/reference-data/reference-data.errors.js';
import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import { PrismaService } from '../database/prisma.service.js';
import { AssignmentBalanceRepository } from './assignment-balance.repository.js';
import {
  EnvelopePlanRepository,
  type EnvelopeHistoryCursor,
  type EnvelopeHistoryItemRecord,
} from './envelope-plan.repository.js';
import type {
  CreateEnvelopeInput,
  EnvelopeHistoryQuery,
  UpdateEnvelopeInput,
} from './envelope-plan.schemas.js';

const RUB_SCALE = 2;
const CREATE_ENVELOPE_OPERATION = 'CREATE_ENVELOPE';
const UPDATE_ENVELOPE_OPERATION = 'UPDATE_ENVELOPE';
const ARCHIVE_ENVELOPE_OPERATION = 'ARCHIVE_ENVELOPE';

type EnvelopePlanBody = {
  id: string;
  name: string;
  envelopeType: string;
  periodSlot: 'FIRST' | 'SECOND' | null;
  targetAmountMinor: string | null;
  comment: string | null;
  fundedMinor: string;
  spentMinor: string;
  balanceMinor: string;
  archivedAt: string | null;
  periods: EnvelopePeriodBody[];
};

type EnvelopePeriodBody = {
  periodId: string;
  startsOn: string;
  endsOn: string;
  fundedMinor: string;
  spentMinor: string;
  balanceMinor: string;
  current: boolean;
};

type BalanceRow = {
  envelopeId: string;
  periodId: string | null;
  funded: bigint;
  spent: bigint;
  balance: bigint;
};

function validationFailed(detail: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_FAILED', detail });
}

function mandatoryExists(): ConflictException {
  return new ConflictException({
    code: 'MANDATORY_ENVELOPE_EXISTS',
    detail: 'Обязательный конверт уже существует для бюджета.',
  });
}

function formatMinorToDecimal(minor: bigint, scale: number): string {
  const factor = 10n ** BigInt(scale);
  const quotient = minor / factor;
  const remainder = minor % factor;
  if (remainder === 0n) return quotient.toString();
  const fraction = remainder.toString().padStart(scale, '0').replace(/0+$/, '');
  return `${quotient}.${fraction}`;
}

function envelopeHasBalance(): ConflictException {
  return new ConflictException({
    code: 'ENVELOPE_HAS_BALANCE',
    detail: 'Конверт не пуст: сначала доведите начисления и переносы до нуля.',
  });
}

const HISTORY_PAGE_LIMIT = 20;
const HISTORY_PAGE_LIMIT_MAX = 100;
const CURSOR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function invalidCursor(): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail: 'Некорректный курсор постраничного чтения.',
  });
}

function encodeHistoryCursor(cursor: EnvelopeHistoryCursor): string {
  return Buffer.from(`${cursor.date}|${cursor.id}`, 'utf8').toString('base64url');
}

function decodeHistoryCursor(cursor: string): EnvelopeHistoryCursor {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = text.indexOf('|');
  const date = text.slice(0, separator);
  const id = text.slice(separator + 1);
  if (
    separator <= 0 ||
    separator + 1 >= text.length ||
    !CURSOR_DATE_PATTERN.test(date) ||
    !CURSOR_ID_PATTERN.test(id) ||
    encodeHistoryCursor({ date, id }) !== cursor
  ) {
    throw invalidCursor();
  }
  return { date, id };
}

@Injectable()
export class EnvelopePlanApplicationService {
  private readonly repository = new EnvelopePlanRepository();
  private readonly balances = new AssignmentBalanceRepository();
  private readonly rolePolicy = new RolePolicy();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async list(
    userId: string,
    budgetId: string,
  ): Promise<{ status: number; body: { items: EnvelopePlanBody[] } }> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(async (tx) => {
      const envelopes = await this.repository.listActive(tx, budgetId);
      const rowBalances = await this.balances.allBalances(tx, budgetId, new Date());
      const totals = this.totalsByEnvelope(rowBalances);
      const periods = await this.periodsByEnvelope(
        tx,
        budgetId,
        envelopes.map((envelope) => envelope.id),
        rowBalances,
      );
      const items = envelopes.map((envelope) => this.toBody(envelope, totals, periods));
      return { status: 200, body: { items } };
    });
  }

  async get(
    userId: string,
    budgetId: string,
    envelopeId: string,
  ): Promise<{ status: number; body: EnvelopePlanBody }> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    return this.prisma.$transaction(async (tx) => {
      const envelope = await this.repository.findEnvelope(tx, budgetId, envelopeId);
      const allRows = await this.balances.allBalances(tx, budgetId, new Date());
      const totals = this.totalsByEnvelope(allRows);
      const periods = await this.periodsByEnvelope(tx, budgetId, [envelope.id], allRows);
      return { status: 200, body: this.toBody(envelope, totals, periods) };
    });
  }

  async create(
    userId: string,
    budgetId: string,
    input: CreateEnvelopeInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<{ status: number; body: EnvelopePlanBody }> {
    const targetAmountMinor =
      input.targetAmountMinor === undefined
        ? null
        : parseDecimalToMinorUnits(input.targetAmountMinor, RUB_SCALE, false);

    if (input.envelopeType === 'CURRENT_EXPENSES' && !input.periodSlot) {
      throw validationFailed('Для CURRENT_EXPENSES обязателен periodSlot (FIRST или SECOND).');
    }
    if (input.periodSlot && input.envelopeType !== 'CURRENT_EXPENSES') {
      throw validationFailed('periodSlot применим только к CURRENT_EXPENSES.');
    }

    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);

    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          name: input.name,
          envelopeType: input.envelopeType,
          periodSlot: input.periodSlot ?? null,
          targetAmountMinor: targetAmountMinor?.toString() ?? null,
          comment: input.comment ?? null,
        }),
      )
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);

      if (input.envelopeType === 'MANDATORY_EXPENSES') {
        const count = await this.repository.countActiveByType(tx, budgetId, 'MANDATORY_EXPENSES');
        if (count > 0) throw mandatoryExists();
      }
      if (input.periodSlot) {
        const slotOwner = await this.repository.findSlotOwner(tx, budgetId, input.periodSlot);
        if (slotOwner) throw periodSlotAlreadyAssigned();
      }
      const displayOrder = await this.repository.nextDisplayOrder(tx, budgetId);

      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: CREATE_ENVELOPE_OPERATION,
          requestHash,
        },
        async () => {
          await this.requireManageRole(tx, model.workspaceId, userId);

          const envelope = await this.repository.createEnvelope(tx, {
            budgetId,
            workspaceId: model.workspaceId,
            actorUserId: userId,
            name: input.name,
            envelopeType: input.envelopeType,
            targetAmountMinor,
            periodSlot: input.periodSlot ?? null,
            comment: input.comment ?? null,
            displayOrder,
            requestId,
          });

          const rowBalances = await this.balances.allBalances(tx, budgetId, new Date());
          const totals = this.totalsByEnvelope(rowBalances);
          const periods = await this.periodsByEnvelope(tx, budgetId, [envelope.id], rowBalances);
          return { status: 201, body: this.toBody(envelope, totals, periods) };
        },
      );
    });
  }

  async update(
    userId: string,
    budgetId: string,
    envelopeId: string,
    input: UpdateEnvelopeInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<{ status: number; body: EnvelopePlanBody }> {
    if (input.name === undefined && input.periodSlot === undefined) {
      throw validationFailed('Укажите изменяемые поля: name и/или periodSlot.');
    }

    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);

    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          envelopeId,
          name: input.name ?? null,
          periodSlot: input.periodSlot ?? null,
        }),
      )
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);
      const current = await this.repository.findEnvelope(tx, budgetId, envelopeId);

      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: UPDATE_ENVELOPE_OPERATION,
          requestHash,
        },
        async () => {
          await this.requireManageRole(tx, model.workspaceId, userId);

          if (input.periodSlot !== undefined) {
            if (current.envelopeType !== 'CURRENT_EXPENSES') {
              throw validationFailed('periodSlot применим только к CURRENT_EXPENSES.');
            }
            if (await this.repository.hasAssignments(tx, budgetId, envelopeId)) {
              throw validationFailed(
                'Область действия конверта с историей не может быть изменена.',
              );
            }
            const slotOwner = await this.repository.findSlotOwner(
              tx,
              budgetId,
              input.periodSlot,
              envelopeId,
            );
            if (slotOwner) throw periodSlotAlreadyAssigned();
          }

          const updated = await this.repository.applyUpdate(tx, {
            budgetId,
            workspaceId: model.workspaceId,
            actorUserId: userId,
            envelopeId,
            oldName: current.name,
            ...(input.name !== undefined ? { newName: input.name } : {}),
            oldPeriodSlot: current.periodSlot,
            ...(input.periodSlot !== undefined ? { newPeriodSlot: input.periodSlot } : {}),
            ...(requestId ? { requestId } : {}),
          });

          const rowBalances = await this.balances.allBalances(tx, budgetId, new Date());
          const totals = this.totalsByEnvelope(rowBalances);
          const periods = await this.periodsByEnvelope(tx, budgetId, [updated.id], rowBalances);
          return { status: 200, body: this.toBody(updated, totals, periods) };
        },
      );
    });
  }

  async archive(
    userId: string,
    budgetId: string,
    envelopeId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<{ status: number; body: EnvelopePlanBody }> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);

    const requestHash = createHash('sha256').update(JSON.stringify({ envelopeId })).digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);
      const current = await this.repository.findEnvelope(tx, budgetId, envelopeId);

      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: ARCHIVE_ENVELOPE_OPERATION,
          requestHash,
        },
        async () => {
          await this.requireManageRole(tx, model.workspaceId, userId);

          if (current.archivedAt) {
            throw validationFailed('Конверт уже архивирован.');
          }

          const rowBalances = await this.balances.allBalances(tx, budgetId, new Date());
          const total = (
            this.totalsByEnvelope(rowBalances).get(envelopeId) ?? {
              funded: 0n,
              spent: 0n,
              balance: 0n,
            }
          ).balance;
          if (total !== 0n) throw envelopeHasBalance();

          const updated = await this.repository.setArchived(tx, {
            budgetId,
            workspaceId: model.workspaceId,
            actorUserId: userId,
            envelopeId,
            archivedAt: new Date(),
            requestId,
          });

          const periods = await this.periodsByEnvelope(tx, budgetId, [updated.id], rowBalances);
          return {
            status: 200,
            body: this.toBody(updated, this.totalsByEnvelope(rowBalances), periods),
          };
        },
      );
    });
  }

  async history(
    userId: string,
    budgetId: string,
    envelopeId: string,
    query: EnvelopeHistoryQuery,
  ): Promise<{
    status: number;
    body: { items: EnvelopeHistoryItemRecord[]; nextCursor: string | null };
  }> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const limit = Math.min(Math.max(query.limit ?? HISTORY_PAGE_LIMIT, 1), HISTORY_PAGE_LIMIT_MAX);
    const status = query.status ?? 'CONFIRMED';
    const cursor = query.cursor ? decodeHistoryCursor(query.cursor) : null;

    return this.prisma.$transaction(async (tx) => {
      await this.repository.findEnvelope(tx, budgetId, envelopeId);
      const rows = await this.repository.listHistory(
        tx,
        budgetId,
        envelopeId,
        limit + 1,
        cursor,
        status,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[limit - 1];
      const nextCursor =
        hasMore && last !== undefined
          ? encodeHistoryCursor({ date: last.effectiveOn, id: last.id })
          : null;
      return { status: 200, body: { items: page, nextCursor } };
    });
  }

  private async requireManageRole(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const membership = await tx.workspaceMembership.findFirst({
      where: { workspaceId, userId, isActive: true },
      select: { role: true },
    });
    if (!membership || !this.rolePolicy.canManage(membership.role)) {
      throw forbidden();
    }
  }

  // Periods with money movement plus the current one, per envelope. The period
  // buckets are read with the budget filter in the query; "current" is decided
  // by the server in the budget timezone, never by the browser.
  private async periodsByEnvelope(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopeIds: string[],
    rows: BalanceRow[],
  ): Promise<Map<string, EnvelopePeriodBody[]>> {
    const result = new Map<string, EnvelopePeriodBody[]>();
    const periods = await this.repository.listPeriods(tx, budgetId, envelopeIds);
    if (periods.length === 0) return result;
    const today = todayInTimezone(
      new Date(),
      await this.repository.requireBudgetTimezone(tx, budgetId),
    );
    const byPeriod = new Map<string, BalanceRow>();
    for (const row of rows) {
      if (row.periodId !== null) byPeriod.set(row.periodId, row);
    }
    for (const period of periods) {
      // Periods that have not started yet have no balance row.
      const row = byPeriod.get(period.id);
      if (!row) continue;
      const startsOn = period.startsOn.toISOString().slice(0, 10);
      const endsOn = period.endsOn.toISOString().slice(0, 10);
      const current = startsOn <= today && today <= endsOn;
      if (!current && row.funded === 0n && row.spent === 0n) continue;
      const list = result.get(period.envelopeId) ?? [];
      list.push({
        periodId: period.id,
        startsOn,
        endsOn,
        fundedMinor: formatMinorUnits(row.funded),
        spentMinor: formatMinorUnits(row.spent),
        balanceMinor: formatMinorUnits(row.balance),
        current,
      });
      result.set(period.envelopeId, list);
    }
    return result;
  }

  private totalsByEnvelope(
    rows: Array<{ envelopeId: string; funded: bigint; spent: bigint; balance: bigint }>,
  ): Map<string, { funded: bigint; spent: bigint; balance: bigint }> {
    const totals = new Map<string, { funded: bigint; spent: bigint; balance: bigint }>();
    for (const row of rows) {
      const existing = totals.get(row.envelopeId) ?? { funded: 0n, spent: 0n, balance: 0n };
      totals.set(row.envelopeId, {
        funded: existing.funded + row.funded,
        spent: existing.spent + row.spent,
        balance: existing.balance + row.balance,
      });
    }
    return totals;
  }

  private toBody(
    envelope: Awaited<ReturnType<EnvelopePlanRepository['findEnvelope']>>,
    totals: Map<string, { funded: bigint; spent: bigint; balance: bigint }>,
    periods: Map<string, EnvelopePeriodBody[]>,
  ): EnvelopePlanBody {
    const t = totals.get(envelope.id) ?? { funded: 0n, spent: 0n, balance: 0n };
    return {
      id: envelope.id,
      name: envelope.name,
      envelopeType: envelope.envelopeType,
      periodSlot: envelope.periodSlot,
      targetAmountMinor:
        envelope.targetAmountMinor === null
          ? null
          : formatMinorToDecimal(envelope.targetAmountMinor, RUB_SCALE),
      comment: envelope.comment,
      fundedMinor: formatMinorUnits(t.funded),
      spentMinor: formatMinorUnits(t.spent),
      balanceMinor: formatMinorUnits(t.balance),
      archivedAt: envelope.archivedAt ? envelope.archivedAt.toISOString() : null,
      periods: periods.get(envelope.id) ?? [],
    };
  }
}
