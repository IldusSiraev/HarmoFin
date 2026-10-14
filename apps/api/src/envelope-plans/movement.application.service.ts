import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { RolePolicy } from '../common/policies/role-policy.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import { forbidden } from '../common/reference-data/reference-data.errors.js';
import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import { PrismaService } from '../database/prisma.service.js';
import { AssignmentBalanceRepository } from './assignment-balance.repository.js';
import { MovementRepository } from './movement.repository.js';
import type { MoveEnvelopeInput } from './movement.schemas.js';

const RUB_SCALE = 2;
const MOVE_ENVELOPE_OPERATION = 'MOVE_ENVELOPE';

export type MoveResult = {
  status: number;
  body: {
    movementId: string;
    amountMinor: string;
    sourceBalanceMinor: string;
    destinationBalanceMinor: string | null;
    cashMinor: string;
  };
};

function validationFailed(detail: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_FAILED', detail });
}

function insufficientEnvelopeBalance(): ConflictException {
  return new ConflictException({
    code: 'INSUFFICIENT_ENVELOPE_BALANCE',
    detail: 'Нельзя перевести больше доступного остатка исходного конверта (или его периода).',
  });
}

@Injectable()
export class MovementApplicationService {
  private readonly repository = new MovementRepository();
  private readonly balances = new AssignmentBalanceRepository();
  private readonly rolePolicy = new RolePolicy();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
  ) {}

  async move(
    userId: string,
    budgetId: string,
    input: MoveEnvelopeInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<MoveResult> {
    const amountMinor = parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
    if (amountMinor === 0n) {
      throw validationFailed('Сумма переноса должна быть больше нуля.');
    }

    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);

    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          sourceEnvelopeId: input.sourceEnvelopeId,
          sourcePeriodId: input.sourcePeriodId ?? null,
          destinationEnvelopeId: input.destinationEnvelopeId ?? null,
          destinationPeriodId: input.destinationPeriodId ?? null,
          amountMinor: amountMinor.toString(),
        }),
      )
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      await this.repository.lockBudget(tx, budgetId);

      const sourceEnvelope = await this.repository.requireEnvelope(
        tx,
        budgetId,
        input.sourceEnvelopeId,
      );
      const destinationEnvelope = input.destinationEnvelopeId
        ? await this.repository.requireEnvelope(tx, budgetId, input.destinationEnvelopeId)
        : null;

      await this.repository.lockEnvelopes(tx, [
        sourceEnvelope.id,
        ...(destinationEnvelope ? [destinationEnvelope.id] : []),
      ]);

      if (input.destinationPeriodId && !destinationEnvelope) {
        throw validationFailed('Период переноса требует конверта-получателя.');
      }

      let sourcePeriodId: string | null = null;
      if (input.sourcePeriodId) {
        sourcePeriodId = (
          await this.repository.requireEnvelopePeriod(
            tx,
            budgetId,
            input.sourceEnvelopeId,
            input.sourcePeriodId,
          )
        ).id;
      }
      let destinationPeriodId: string | null = null;
      if (input.destinationPeriodId) {
        destinationPeriodId = (
          await this.repository.requireEnvelopePeriod(
            tx,
            budgetId,
            destinationEnvelope!.id,
            input.destinationPeriodId,
          )
        ).id;
      }

      if (sourceEnvelope.id === destinationEnvelope?.id) {
        if (!sourcePeriodId || !destinationPeriodId || sourcePeriodId === destinationPeriodId) {
          throw validationFailed(
            'Перенос в тот же конверт возможен только между разными периодами.',
          );
        }
      }

      return this.idempotency.execute(
        tx,
        {
          budgetId,
          actorUserId: userId,
          key: idempotencyKey,
          operation: MOVE_ENVELOPE_OPERATION,
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

          const timezone = await this.repository.requireBudgetTimezone(tx, budgetId);
          const asOfDate = new Date(`${todayInTimezone(new Date(), timezone)}T00:00:00Z`);

          const sourceBalance = await this.balances.balance(
            tx,
            budgetId,
            sourceEnvelope.id,
            sourcePeriodId,
            asOfDate,
          );
          if (sourceBalance.balance < amountMinor) {
            throw insufficientEnvelopeBalance();
          }

          const movement = await this.repository.createMovement(tx, {
            budgetId,
            workspaceId: model.workspaceId,
            actorUserId: userId,
            sourceEnvelopeId: sourceEnvelope.id,
            sourcePeriodId,
            destinationEnvelopeId: destinationEnvelope?.id ?? null,
            destinationPeriodId,
            amountMinor,
            effectiveOn: asOfDate,
            requestId,
          });

          const destinationBalance = destinationEnvelope
            ? await this.balances.balance(
                tx,
                budgetId,
                destinationEnvelope.id,
                destinationPeriodId,
                asOfDate,
              )
            : null;
          const cash = await this.repository.cashAt(tx, budgetId, asOfDate);

          return {
            status: 201,
            body: {
              movementId: movement.id,
              amountMinor: formatMinorUnits(amountMinor),
              sourceBalanceMinor: formatMinorUnits(sourceBalance.balance - amountMinor),
              destinationBalanceMinor: destinationBalance
                ? formatMinorUnits(destinationBalance.balance)
                : null,
              cashMinor: formatMinorUnits(cash),
            },
          };
        },
      );
    });
  }
}
