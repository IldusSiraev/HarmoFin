import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { RolePolicy } from '../common/policies/role-policy.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import { PrismaService } from '../database/prisma.service.js';
import { AssignmentBalanceRepository } from './assignment-balance.repository.js';
import { AssignmentRepository } from './assignment.repository.js';
import type {
  CreateEnvelopeAssignmentInput,
  CreateIncomeAssignmentInput,
} from './assignment.schemas.js';

const RUB_SCALE = 2;
const ASSIGN_FREE_OPERATION = 'ASSIGN_FREE';
const ASSIGN_INCOME_OPERATION = 'ASSIGN_INCOME';

export type AssignFreeResult = {
  status: number;
  body: {
    assignmentId: string;
    amountMinor: string;
    fundedMinor: string;
    spentMinor: string;
    balanceMinor: string;
    freeToAssignMinor: string;
  };
};

function positive(minor: bigint): bigint {
  return minor > 0n ? minor : 0n;
}

function validationFailed(detail: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_FAILED', detail });
}

function insufficientFunds(): ConflictException {
  return new ConflictException({
    code: 'ASSIGNMENT_UNBACKED',
    detail: 'Назначению не хватает подтверждённых наличных средств бюджета.',
  });
}

function sourceExhausted(): ConflictException {
  return new ConflictException({
    code: 'SOURCE_EXHAUSTED',
    detail:
      'На этот доход уже назначены все подтверждённые средства; уменьшите или отмените существующие назначения.',
  });
}

export type AssignIncomeResult = {
  status: number;
  body: {
    assignmentId: string;
    amountMinor: string;
    fundedMinor: string;
    spentMinor: string;
    balanceMinor: string;
    freeToAssignMinor: string;
  };
};

@Injectable()
export class AssignmentApplicationService {
  private readonly repository = new AssignmentRepository();
  private readonly balances = new AssignmentBalanceRepository();
  private readonly rolePolicy = new RolePolicy();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async assignFree(
    userId: string,
    budgetId: string,
    input: CreateEnvelopeAssignmentInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<AssignFreeResult> {
    const amountMinor = parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
    if (amountMinor === 0n) {
      throw validationFailed('Сумма назначения должна быть больше нуля.');
    }

    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);

    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          envelopeId: input.envelopeId,
          periodId: input.periodId ?? null,
          amountMinor: amountMinor.toString(),
          sourceKind: input.sourceKind,
        }),
      )
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);

      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: ASSIGN_FREE_OPERATION,
          requestHash,
        },
        async () => {
          const membership = await tx.workspaceMembership.findFirst({
            where: { workspaceId: model.workspaceId, userId, isActive: true },
            select: { role: true },
          });
          if (!membership || !this.rolePolicy.canManage(membership.role)) {
            throw forbidden();
          }

          const envelope = await this.repository.requireEnvelope(tx, budgetId, input.envelopeId);
          if (envelope.archivedAt) {
            throw validationFailed('Архивированный конверт не принимает назначения.');
          }

          let targetPeriodId: string | null = null;
          if (input.periodId) {
            if (!envelope.hasPeriods) {
              throw validationFailed(
                'У этого конверта нет периодов; назначайте средства в конверт целиком.',
              );
            }
            const period = await this.repository.findPeriod(
              tx,
              budgetId,
              input.envelopeId,
              input.periodId,
            );
            if (!period) {
              throw resourceNotFound();
            }
            targetPeriodId = period.id;
          } else if (envelope.hasPeriods) {
            throw validationFailed('Для периодного конверта укажите periodId назначения.');
          }

          const timezone = await this.repository.requireBudgetTimezone(tx, budgetId);
          const asOfDate = new Date(`${todayInTimezone(new Date(), timezone)}T00:00:00Z`);

          if (
            input.sourceKind === 'OPENING' &&
            (await this.repository.hasConfirmedFact(tx, budgetId, asOfDate))
          ) {
            throw validationFailed(
              'Начальное назначение (OPENING) доступно только до первой подтверждённой операции бюджета. Используйте FREE.',
            );
          }

          const cash = await this.repository.cashAt(tx, budgetId, asOfDate);
          const rows = await this.balances.allBalances(tx, budgetId, asOfDate);
          const targetRow =
            rows.find((row) => row.envelopeId === envelope.id && row.periodId === targetPeriodId) ??
            null;

          const protectedBefore = rows.reduce((sum, row) => sum + positive(row.balance), 0n);
          const targetAfter = (targetRow?.balance ?? 0n) + amountMinor;
          const protectedAfter =
            protectedBefore - positive(targetRow?.balance ?? 0n) + positive(targetAfter);
          if (protectedAfter > cash) {
            throw insufficientFunds();
          }

          const fundedAfter = (targetRow?.funded ?? 0n) + amountMinor;
          const spentAfter = targetRow?.spent ?? 0n;
          const balanceAfter = fundedAfter - spentAfter;
          const freeToAssignAfter = cash - protectedAfter;

          const assignment = await this.repository.createAssignment(tx, {
            budgetId,
            workspaceId: model.workspaceId,
            actorUserId: userId,
            envelopeId: input.envelopeId,
            periodId: targetPeriodId,
            sourceKind: input.sourceKind,
            amountMinor,
            effectiveOn: asOfDate,
            sourceIncomeTransactionId: null,
            requestId,
          });
          return {
            status: 201,
            body: {
              assignmentId: assignment.id,
              amountMinor: formatMinorUnits(amountMinor),
              fundedMinor: formatMinorUnits(fundedAfter),
              spentMinor: formatMinorUnits(spentAfter),
              balanceMinor: formatMinorUnits(balanceAfter),
              freeToAssignMinor: formatMinorUnits(freeToAssignAfter),
            },
          };
        },
      );
    });
  }

  async assignIncome(
    userId: string,
    budgetId: string,
    input: CreateIncomeAssignmentInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<AssignIncomeResult> {
    const amountMinor = parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
    if (amountMinor === 0n) {
      throw validationFailed('Сумма назначения должна быть больше нуля.');
    }

    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);

    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          incomeTransactionId: input.incomeTransactionId,
          envelopeId: input.envelopeId,
          periodId: input.periodId ?? null,
          amountMinor: amountMinor.toString(),
        }),
      )
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);

      await this.repository.lockIncome(tx, budgetId, input.incomeTransactionId);
      const income = await this.repository.requireIncome(tx, budgetId, input.incomeTransactionId);

      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: ASSIGN_INCOME_OPERATION,
          requestHash,
        },
        async () => {
          const membership = await tx.workspaceMembership.findFirst({
            where: { workspaceId: model.workspaceId, userId, isActive: true },
            select: { role: true },
          });
          if (!membership || !this.rolePolicy.canManage(membership.role)) {
            throw forbidden();
          }

          const envelope = await this.repository.requireEnvelope(tx, budgetId, input.envelopeId);
          if (envelope.archivedAt) {
            throw validationFailed('Архивированный конверт не принимает назначения.');
          }

          let targetPeriodId: string | null = null;
          if (input.periodId) {
            if (!envelope.hasPeriods) {
              throw validationFailed(
                'У этого конверта нет периодов; назначайте средства в конверт целиком.',
              );
            }
            const period = await this.repository.findPeriod(
              tx,
              budgetId,
              input.envelopeId,
              input.periodId,
            );
            if (!period) {
              throw resourceNotFound();
            }
            targetPeriodId = period.id;
          } else if (envelope.hasPeriods) {
            throw validationFailed('Для периодного конверта укажите periodId назначения.');
          }

          const assigned = await this.repository.sumIncomeAssigned(
            tx,
            budgetId,
            input.incomeTransactionId,
          );
          if (assigned + amountMinor > income.amountMinor) {
            throw sourceExhausted();
          }

          const timezone = await this.repository.requireBudgetTimezone(tx, budgetId);
          const asOfDate = new Date(`${todayInTimezone(new Date(), timezone)}T00:00:00Z`);

          const cash = await this.repository.cashAt(tx, budgetId, asOfDate);
          const rows = await this.balances.allBalances(tx, budgetId, asOfDate);
          const targetRow =
            rows.find((row) => row.envelopeId === envelope.id && row.periodId === targetPeriodId) ??
            null;

          const protectedBefore = rows.reduce((sum, row) => sum + positive(row.balance), 0n);
          const targetAfter = (targetRow?.balance ?? 0n) + amountMinor;
          const protectedAfter =
            protectedBefore - positive(targetRow?.balance ?? 0n) + positive(targetAfter);
          if (protectedAfter > cash) {
            throw insufficientFunds();
          }

          const fundedAfter = (targetRow?.funded ?? 0n) + amountMinor;
          const spentAfter = targetRow?.spent ?? 0n;
          const balanceAfter = fundedAfter - spentAfter;
          const freeToAssignAfter = cash - protectedAfter;

          const assignment = await this.repository.createAssignment(tx, {
            budgetId,
            workspaceId: model.workspaceId,
            actorUserId: userId,
            envelopeId: input.envelopeId,
            periodId: targetPeriodId,
            sourceKind: 'INCOME',
            amountMinor,
            effectiveOn: asOfDate,
            sourceIncomeTransactionId: input.incomeTransactionId,
            requestId,
          });
          return {
            status: 201,
            body: {
              assignmentId: assignment.id,
              amountMinor: formatMinorUnits(amountMinor),
              fundedMinor: formatMinorUnits(fundedAfter),
              spentMinor: formatMinorUnits(spentAfter),
              balanceMinor: formatMinorUnits(balanceAfter),
              freeToAssignMinor: formatMinorUnits(freeToAssignAfter),
            },
          };
        },
      );
    });
  }
}
