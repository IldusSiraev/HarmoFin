import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { RolePolicy } from '../common/policies/role-policy.js';
import { forbidden, resourceNotFound } from '../common/reference-data/reference-data.errors.js';
import { cycleAndPeriodFor } from '../cycles/cycle-period.domain.js';
import { PrismaService } from '../database/prisma.service.js';
import { EnvelopePlanRepository } from './envelope-plan.repository.js';
import type { PutFundingRuleInput, PutPeriodTargetInput } from './envelope-plan.schemas.js';
import { type EnvelopePeriodRecord, FundingRuleRepository } from './funding-rule.repository.js';

const RUB_SCALE = 2;
const PUT_FUNDING_RULE_OPERATION = 'PUT_FUNDING_RULE';
const PUT_PERIOD_TARGET_OPERATION = 'PUT_PERIOD_TARGET';
const CONFIRM_TARGET_OPERATION = 'CONFIRM_PERIOD_TARGET';
const REJECT_TARGET_OPERATION = 'REJECT_PERIOD_TARGET';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type FundingRuleBody = {
  id: string;
  envelopeId: string;
  type: string;
  priority: number;
  fixedAmountMinor: string | null;
  percentBasisPoints: number | null;
};

export type PeriodTargetBody = {
  periodId: string;
  envelopeId: string;
  periodStart: string;
  periodEnd: string;
  targetMinor: string | null;
  targetStatus: string;
  /** Equals targetMinor while the target is a DRAFT suggestion, otherwise null. */
  suggestedTargetMinor: string | null;
  /** Equals targetMinor while the target is CONFIRMED, otherwise null. */
  confirmedTargetMinor: string | null;
  confirmedAt: string | null;
};

function validationFailed(detail: string, field?: string): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    detail,
    ...(field ? { fieldErrors: [{ field, message: detail, code: 'invalid' }] } : {}),
  });
}

function unprocessable(code: string, detail: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ code, detail });
}

function positiveMinor(value: string, field: string): bigint {
  const minor = parseDecimalToMinorUnits(value, RUB_SCALE, false);
  if (minor <= 0n) throw validationFailed('Сумма должна быть положительной.', field);
  return minor;
}

@Injectable()
export class PeriodTargetApplicationService {
  private readonly envelopes = new EnvelopePlanRepository();
  private readonly rules = new FundingRuleRepository();
  private readonly rolePolicy = new RolePolicy();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  /** Upserts the single saved rule of an envelope. A rule is a setting, not a money movement. */
  async putFundingRule(
    userId: string,
    budgetId: string,
    envelopeId: string,
    input: PutFundingRuleInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<{ status: number; body: FundingRuleBody }> {
    const fixedMinor =
      input.fixedAmount === undefined ? null : positiveMinor(input.fixedAmount, 'fixedAmount');
    const percentBasisPoints = input.percentBasisPoints ?? null;
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          envelopeId,
          type: input.type,
          priority: input.priority,
          fixedMinor: fixedMinor?.toString() ?? null,
          percentBasisPoints,
        }),
      )
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await this.envelopes.lockBudget(tx, budgetId);
      const envelope = await this.envelopes.findEnvelope(tx, budgetId, envelopeId);

      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: PUT_FUNDING_RULE_OPERATION,
          requestHash,
        },
        async () => {
          await this.requireManageRole(tx, model.workspaceId, userId);
          if (envelope.archivedAt) {
            throw unprocessable('ENVELOPE_ARCHIVED', 'Конверт архивирован.');
          }
          if (input.type === 'SUM_OF_PLANS' && envelope.envelopeType !== 'MANDATORY_EXPENSES') {
            throw unprocessable(
              'FUNDING_RULE_TYPE_NOT_ALLOWED',
              'Правило SUM_OF_PLANS допустимо только для конверта «Обязательные».',
            );
          }
          const rule = await this.rules.saveRule(tx, {
            budgetId,
            workspaceId: model.workspaceId,
            actorUserId: userId,
            envelopeId,
            type: input.type,
            priority: input.priority,
            fixedMinor,
            percentBasisPoints,
            requestId,
          });
          return {
            status: 200,
            body: {
              id: rule.id,
              envelopeId: rule.envelopeId,
              type: rule.type,
              priority: rule.priority,
              fixedAmountMinor: rule.fixedMinor === null ? null : formatMinorUnits(rule.fixedMinor),
              percentBasisPoints: rule.percentBasisPoints,
            },
          };
        },
      );
    });
  }

  /**
   * Explicit owner decision for one concrete period: a number becomes a CONFIRMED target,
   * null clears the target to UNSET. Never touches funded, cash or assignments. The period
   * row is created through the shared getOrCreatePeriod when it is not opened yet.
   */
  async putPeriodTarget(
    userId: string,
    budgetId: string,
    envelopeId: string,
    periodStart: string,
    input: PutPeriodTargetInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<{ status: number; body: PeriodTargetBody }> {
    const targetMinor = input.target === null ? null : parseTarget(input.target);
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ envelopeId, periodStart, target: targetMinor?.toString() ?? null }))
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await this.envelopes.lockBudget(tx, budgetId);
      const envelope = await this.envelopes.findEnvelope(tx, budgetId, envelopeId);

      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: PUT_PERIOD_TARGET_OPERATION,
          requestHash,
        },
        async () => {
          await this.requireManageRole(tx, model.workspaceId, userId);
          if (envelope.archivedAt) {
            throw unprocessable('ENVELOPE_ARCHIVED', 'Конверт архивирован.');
          }
          if (!envelope.periodSlot) {
            throw validationFailed(
              'Цель периода задаётся только для периодных конвертов.',
              'envelopeId',
            );
          }
          const range = await this.periodRangeFor(tx, budgetId, periodStart);
          if (range.id !== envelope.periodSlot) {
            throw validationFailed(
              'Период не соответствует области действия конверта.',
              'periodStart',
            );
          }
          const actor = { workspaceId: model.workspaceId, userId, requestId };
          const opened = await this.rules.getOrCreatePeriod(
            tx,
            budgetId,
            envelopeId,
            range.start,
            range.end,
            actor,
          );
          const period = await this.rules.applyTarget(tx, {
            budgetId,
            workspaceId: model.workspaceId,
            actorUserId: userId,
            period: opened,
            targetMinor,
            requestId,
          });
          return { status: 200, body: periodTargetBody(period) };
        },
      );
    });
  }

  /** DRAFT -> CONFIRMED, keeping targetMinor. Already CONFIRMED is a no-op (no second audit). */
  confirmTarget(
    userId: string,
    budgetId: string,
    periodId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<{ status: number; body: PeriodTargetBody }> {
    return this.decideTarget('CONFIRM', userId, budgetId, periodId, idempotencyKey, requestId);
  }

  /** DRAFT -> UNSET/null. The saved rule for next periods is not touched. CONFIRMED is 409. */
  rejectTarget(
    userId: string,
    budgetId: string,
    periodId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<{ status: number; body: PeriodTargetBody }> {
    return this.decideTarget('REJECT', userId, budgetId, periodId, idempotencyKey, requestId);
  }

  private async decideTarget(
    decision: 'CONFIRM' | 'REJECT',
    userId: string,
    budgetId: string,
    periodId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<{ status: number; body: PeriodTargetBody }> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ decision, periodId }))
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await this.envelopes.lockBudget(tx, budgetId);
      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: decision === 'CONFIRM' ? CONFIRM_TARGET_OPERATION : REJECT_TARGET_OPERATION,
          requestHash,
        },
        async () => {
          await this.requireManageRole(tx, model.workspaceId, userId);
          const period = await this.rules.lockPeriod(tx, budgetId, periodId);
          if (!period) throw resourceNotFound();
          let result = period;
          if (decision === 'CONFIRM') {
            if (period.targetStatus === 'UNSET') {
              throw new ConflictException({
                code: 'PERIOD_TARGET_NOT_DRAFT',
                detail: 'У периода нет предложенной цели для подтверждения.',
              });
            }
            if (period.targetStatus === 'DRAFT') {
              await this.rules.confirmDrafts(tx, budgetId, [periodId], userId, requestId);
              const confirmed = await this.rules.findPeriodById(tx, budgetId, periodId);
              if (!confirmed) throw resourceNotFound();
              result = confirmed;
            }
          } else {
            if (period.targetStatus === 'CONFIRMED') {
              throw new ConflictException({
                code: 'PERIOD_TARGET_ALREADY_CONFIRMED',
                detail: 'Подтверждённую цель нельзя отклонить; измените её явно.',
              });
            }
            if (period.targetStatus === 'DRAFT') {
              result = await this.rules.rejectDraft(tx, {
                budgetId,
                workspaceId: model.workspaceId,
                actorUserId: userId,
                period,
                requestId,
              });
            }
          }
          return { status: 200, body: periodTargetBody(result) };
        },
      );
    });
  }

  /** The period must start exactly on `periodStart` under settings effective on that date. */
  private async periodRangeFor(
    tx: Prisma.TransactionClient,
    budgetId: string,
    periodStart: string,
  ): Promise<{ id: 'FIRST' | 'SECOND'; start: string; end: string }> {
    if (!DATE_PATTERN.test(periodStart)) {
      throw validationFailed('Некорректная дата начала периода.', 'periodStart');
    }
    const settings = await this.rules.settingsAt(tx, budgetId, periodStart);
    if (!settings) throw validationFailed('Настройки бюджета недоступны.');
    let period: { id: 'FIRST' | 'SECOND'; start: string; end: string };
    try {
      period = cycleAndPeriodFor(settings, periodStart).period;
    } catch {
      throw validationFailed('Некорректная дата начала периода.', 'periodStart');
    }
    if (period.start !== periodStart) {
      throw validationFailed('Дата не является началом периода бюджета.', 'periodStart');
    }
    return period;
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
    if (!membership || !this.rolePolicy.canManage(membership.role)) throw forbidden();
  }
}

function periodTargetBody(period: EnvelopePeriodRecord): PeriodTargetBody {
  const targetMinor = period.targetMinor === null ? null : formatMinorUnits(period.targetMinor);
  return {
    periodId: period.id,
    envelopeId: period.envelopeId,
    periodStart: period.startsOn.toISOString().slice(0, 10),
    periodEnd: period.endsOn.toISOString().slice(0, 10),
    targetMinor,
    targetStatus: period.targetStatus,
    suggestedTargetMinor: period.targetStatus === 'DRAFT' ? targetMinor : null,
    confirmedTargetMinor: period.targetStatus === 'CONFIRMED' ? targetMinor : null,
    confirmedAt: period.confirmedAt ? period.confirmedAt.toISOString() : null,
  };
}

function parseTarget(value: string): bigint {
  return parseDecimalToMinorUnits(value, RUB_SCALE, false);
}
