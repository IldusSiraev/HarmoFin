import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import {
  forbidden,
  invalidReference,
  resourceNotFound,
} from '../common/reference-data/reference-data.errors.js';
import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import { nextPeriodEndAt } from '../cycles/cycle-settings-at.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlanOccurrenceRepository } from '../plans/plan-occurrence.repository.js';
import { RegularPlanRepository } from '../plans/regular-plan.repository.js';
import {
  V2OccurrenceMaterializer,
  creationHorizonEnd,
} from '../plans/v2-occurrence-materializer.js';
import { TransactionRepository } from '../transactions/transaction.repository.js';
import { ObligationPlanRepository } from './obligation-plan.repository.js';
import {
  computeUnpaidMinor,
  type ObligationApplicationService,
  type ObligationTransactionView,
  type ObligationWarning,
} from './obligation.application.service.js';
import { ObligationRepository } from './obligation.repository.js';
import type {
  CreateObligationPlanInput,
  ListObligationOccurrencesInput,
  ListObligationPlansInput,
  OneTimePayInput,
  UpdateObligationPlanInput,
} from './obligation-plan.schemas.js';

const RUB_SCALE = 2;

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

export type ObligationPlanView = {
  id: string;
  planType: 'EXPENSE';
  name: string;
  amountMinor: string;
  recurrence: string;
  intervalMonths: number | null;
  scheduledOn: string;
  endOn: string | null;
  categoryId: string | null;
  envelopeId: string | null;
  comment: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
};

export type ObligationPlanCreateResult = ObligationPlanView & {
  occurrenceId: string | null;
  occurrencesCreated: number;
};

export type ObligationOneTimePayResult = {
  plannedMinor: string;
  actualMinor: string;
  occurrenceId: string;
  planId: string;
  transaction: ObligationTransactionView | null;
  warnings: ObligationWarning[];
};

export type ObligationPlanUpdateResult = ObligationPlanView & {
  updatedOccurrences: number;
  cancelledOccurrences: number;
};

export type ObligationOccurrenceListItem = {
  id: string;
  planId: string;
  name: string;
  scheduledOn: string;
  status: string;
  expectedMinor: string;
  paidMinor: string;
  unpaidMinor: string;
  categoryId: string | null;
  envelopeId: string | null;
};

const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const dateValue = (value: string) => new Date(`${value}T00:00:00.000Z`);

function validationFailed(detail: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_FAILED', detail });
}

function mandatoryEnvelopeRequired(): ConflictException {
  return new ConflictException({
    code: 'MANDATORY_ENVELOPE_REQUIRED',
    detail: 'Для обязательных платежей нужен активный конверт обязательных расходов.',
  });
}

/**
 * v2 obligation plan management (one-time and recurring EXPENSE plans on the mandatory envelope).
 * Plan management is OWNER-only; every member may read. Lock order: budget row -> idempotency
 * advisory lock -> plan rows (same FOR UPDATE as the occurrence materializer).
 */
@Injectable()
export class ObligationPlanApplicationService {
  private readonly transactions: TransactionRepository;
  private readonly plans: RegularPlanRepository;
  private readonly planData = new ObligationPlanRepository();
  private readonly obligations = new ObligationRepository();
  private readonly materializer: V2OccurrenceMaterializer;
  private readonly occurrences = new PlanOccurrenceRepository();

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
    private readonly payments: ObligationApplicationService,
  ) {
    this.transactions = new TransactionRepository(prisma);
    this.plans = new RegularPlanRepository(prisma);
    this.materializer = new V2OccurrenceMaterializer(this.plans, this.occurrences);
  }

  async listPlans(
    userId: string,
    budgetId: string,
    query: ListObligationPlansInput,
  ): Promise<{ items: ObligationPlanView[] }> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const rows = await this.planData.listPlans(this.prisma, budgetId, query.status);
    return {
      items: rows.map((row) => this.planView(row)),
    };
  }

  async listOccurrences(
    userId: string,
    budgetId: string,
    query: ListObligationOccurrencesInput,
  ): Promise<{ items: ObligationOccurrenceListItem[] }> {
    await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const rows = await this.planData.listOccurrences(this.prisma, budgetId, {
      planId: query.planId,
      status: query.status,
      from: query.from ? dateValue(query.from) : undefined,
      to: query.to ? dateValue(query.to) : undefined,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        planId: row.planId,
        name: row.planName,
        scheduledOn: isoDate(row.scheduledOn),
        status: row.status,
        expectedMinor: formatMinorUnits(row.amountMinor),
        paidMinor: formatMinorUnits(row.paidMinor),
        unpaidMinor: formatMinorUnits(
          computeUnpaidMinor(row.status, row.amountMinor, row.paidMinor),
        ),
        categoryId: row.categoryId,
        envelopeId: row.envelopeId,
      })),
    };
  }

  async createPlan(
    userId: string,
    budgetId: string,
    input: CreateObligationPlanInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<ObligationPlanCreateResult> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const hash = this.hash({ budgetId, ...input, amount: input.amount.trim() });
    return this.run<ObligationPlanCreateResult>(
      budgetId,
      userId,
      idempotencyKey,
      'obligation.plan.create',
      hash,
      model.workspaceId,
      201,
      (tx) => this.createPlanInTransaction(tx, userId, budgetId, model, input, requestId),
    );
  }

  /**
   * Atomic "one-time mandatory payment": ONE_TIME plan + occurrence + confirmed v2 expense +
   * PlanPayment in one transaction under one budget lock and one idempotency scope.
   * Allowed for OWNER and EDITOR (it records a real payment, like obligation pay).
   */
  async payOneTime(
    userId: string,
    budgetId: string,
    input: OneTimePayInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<ObligationOneTimePayResult> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const hash = this.hash({
      budgetId,
      ...input,
      plannedAmount: input.plannedAmount.trim(),
      actualAmount: input.actualAmount.trim(),
    });
    return this.run<ObligationOneTimePayResult>(
      budgetId,
      userId,
      idempotencyKey,
      'obligation.one-time-pay',
      hash,
      model.workspaceId,
      201,
      async (tx) => {
        const created = await this.createPlanInTransaction(
          tx,
          userId,
          budgetId,
          model,
          {
            name: input.name,
            amount: input.plannedAmount,
            scheduledOn: input.occurredOn,
            categoryId: input.categoryId,
            recurrence: 'ONE_TIME',
            comment: input.comment ?? null,
          },
          requestId,
        );
        if (!created.occurrenceId) throw resourceNotFound();
        const paid = await this.payments.payInTransaction(
          tx,
          userId,
          budgetId,
          model.workspaceId,
          created.occurrenceId,
          {
            accountId: input.accountId,
            categoryId: input.categoryId,
            amount: input.actualAmount,
            occurredOn: input.occurredOn,
            willPayMore: false,
          },
          dateValue(input.occurredOn),
          requestId,
        );
        return {
          plannedMinor: created.amountMinor,
          actualMinor: paid.transaction?.amountMinor ?? '0',
          occurrenceId: created.occurrenceId,
          planId: created.id,
          transaction: paid.transaction,
          warnings: paid.warnings,
        };
      },
      true,
    );
  }

  private async createPlanInTransaction(
    tx: Tx,
    userId: string,
    budgetId: string,
    model: { workspaceId: string; planModelActivatedOn: Date | null },
    input: CreateObligationPlanInput,
    requestId?: string,
  ): Promise<ObligationPlanCreateResult> {
    const amount = parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
    if (amount <= 0n) throw validationFailed('Сумма должна быть больше нуля.');
    const budget = await this.transactions.findBudgetSettings(tx, budgetId);
    if (!budget) throw resourceNotFound();
    const category = await this.obligations.findExpenseCategory(tx, budgetId, input.categoryId);
    if (!category) throw resourceNotFound();
    if (category.categoryType !== 'EXPENSE') throw invalidReference();
    const envelope = await this.planData.findMandatoryEnvelope(tx, budgetId);
    if (!envelope) throw mandatoryEnvelopeRequired();
    if (envelope.currency !== 'RUB' || envelope.scale !== RUB_SCALE) throw invalidReference();
    const activatedOn = model.planModelActivatedOn ? isoDate(model.planModelActivatedOn) : null;
    if (input.recurrence === 'ONE_TIME' && activatedOn && input.scheduledOn < activatedOn) {
      throw validationFailed('Дата разового платежа раньше даты запуска новой модели.');
    }

    const start = dateValue(input.scheduledOn);
    const plan = await this.plans.createPlan(
      tx,
      {
        workspaceId: model.workspaceId,
        budgetId,
        name: input.name,
        planType: 'EXPENSE',
        amountMinor: amount,
        anchorOn: start,
        startOn: start,
        endOn: input.endOn ? dateValue(input.endOn) : null,
        recurrence: input.recurrence,
        intervalMonths: input.intervalMonths ?? null,
        accountId: null,
        categoryId: category.id,
        envelopeId: envelope.id,
        comment: input.comment ?? null,
        isActive: true,
        disabledAt: null,
        ownerUserId: userId,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
      userId,
      requestId,
    );

    const today = todayInTimezone(new Date(), budget.timezone);
    let to = creationHorizonEnd(today, await nextPeriodEndAt(tx, budgetId, today, budget));
    if (input.recurrence === 'ONE_TIME' && input.scheduledOn > to) to = input.scheduledOn;
    const created = await this.materializer.ensureOccurrences(tx, budgetId, input.scheduledOn, to, {
      actorUserId: userId,
    });
    const occurrenceId = await this.planData.findOccurrenceIdAt(tx, budgetId, plan.id, start);
    if (input.recurrence === 'ONE_TIME' && !occurrenceId) {
      throw validationFailed('Не удалось создать разовый платёж.');
    }
    return { ...this.planView(plan), occurrenceId, occurrencesCreated: created };
  }

  async updatePlan(
    userId: string,
    budgetId: string,
    planId: string,
    input: UpdateObligationPlanInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<ObligationPlanUpdateResult> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const hash = this.hash({ budgetId, planId, ...input, amount: input.amount?.trim() });
    return this.run<ObligationPlanUpdateResult>(
      budgetId,
      userId,
      idempotencyKey,
      'obligation.plan.update',
      hash,
      model.workspaceId,
      200,
      async (tx) => {
        const current = await this.plans.findPlanForMutation(tx, userId, budgetId, planId);
        if (!current || current.planType !== 'EXPENSE' || !current.envelopeId) {
          throw resourceNotFound();
        }
        const envelope = await this.obligations.findEnvelope(tx, budgetId, current.envelopeId);
        if (!envelope || envelope.envelopeType !== 'MANDATORY_EXPENSES') throw resourceNotFound();
        const budget = await this.transactions.findBudgetSettings(tx, budgetId);
        if (!budget) throw resourceNotFound();

        const amount =
          input.amount === undefined
            ? current.amountMinor
            : parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
        if (amount <= 0n) throw validationFailed('Сумма должна быть больше нуля.');
        const archiving = input.status === 'ARCHIVED' && current.isActive;
        const reactivating = input.status === 'ACTIVE' && !current.isActive;
        const isActive = archiving ? false : reactivating ? true : current.isActive;

        const plan = await this.plans.updatePlan(
          tx,
          current,
          {
            name: input.name ?? current.name,
            planType: current.planType,
            amountMinor: amount,
            anchorOn: current.anchorOn,
            startOn: current.startOn,
            endOn: current.endOn,
            recurrence: current.recurrence,
            intervalMonths: current.intervalMonths,
            accountId: current.accountId,
            categoryId: current.categoryId,
            envelopeId: current.envelopeId,
            comment: current.comment,
            isActive,
            disabledAt: isActive ? null : (current.disabledAt ?? new Date()),
            updatedByUserId: userId,
          },
          userId,
          requestId,
        );

        const today = todayInTimezone(new Date(), budget.timezone);
        const todayDate = dateValue(today);
        let updated = 0;
        let cancelled = 0;
        const futureIds = await this.planData.findFutureUnpaidIds(tx, budgetId, planId, todayDate);
        if (archiving) {
          cancelled = await this.planData.cancelOccurrences(
            tx,
            { id: budgetId, workspaceId: model.workspaceId },
            futureIds,
            userId,
            requestId,
          );
        } else if (current.isActive) {
          if (input.name !== undefined && input.name !== current.name) {
            await this.planData.renameOccurrences(
              tx,
              { id: budgetId, workspaceId: model.workspaceId },
              planId,
              futureIds,
              input.name,
              userId,
              requestId,
            );
          }
          if (amount !== current.amountMinor) {
            for (const id of futureIds) {
              if (
                await this.occurrences.updateOpenExpected(
                  tx,
                  budgetId,
                  id,
                  amount,
                  userId,
                  requestId,
                )
              ) {
                updated += 1;
              }
            }
          }
          if (input.applyToCurrentOpen && amount !== current.amountMinor) {
            const currentIds = await this.planData.findCurrentOpenIds(
              tx,
              budgetId,
              planId,
              todayDate,
            );
            for (const id of currentIds) {
              if (
                await this.occurrences.updateOpenExpected(
                  tx,
                  budgetId,
                  id,
                  amount,
                  userId,
                  requestId,
                )
              ) {
                updated += 1;
              }
            }
          }
        }
        if (reactivating) {
          const restoredIds = await this.planData.restoreDisabledOccurrences(
            tx,
            { id: budgetId, workspaceId: model.workspaceId },
            planId,
            todayDate,
            userId,
            requestId,
          );
          if (input.name !== undefined && input.name !== current.name) {
            await this.planData.renameOccurrences(
              tx,
              { id: budgetId, workspaceId: model.workspaceId },
              planId,
              restoredIds,
              input.name,
              userId,
              requestId,
            );
          }
          if (amount !== current.amountMinor) {
            for (const id of restoredIds) {
              if (
                await this.occurrences.updateOpenExpected(
                  tx,
                  budgetId,
                  id,
                  amount,
                  userId,
                  requestId,
                )
              ) {
                updated += 1;
              }
            }
          }
          await this.materializer.ensureOccurrences(
            tx,
            budgetId,
            today,
            await nextPeriodEndAt(tx, budgetId, today, budget),
            { actorUserId: userId },
          );
        }
        return {
          ...this.planView(plan),
          updatedOccurrences: updated,
          cancelledOccurrences: cancelled,
        };
      },
    );
  }

  private async run<T extends Record<string, unknown>>(
    budgetId: string,
    userId: string,
    key: string,
    operation: string,
    requestHash: string,
    workspaceId: string,
    status: number,
    body: (tx: Tx) => Promise<T>,
    allowEditor = false,
  ): Promise<T> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.transactions.lockBudget(tx, budgetId);
      return this.idempotency.execute<T>(
        tx,
        { budgetId, actorUserId: userId, key, operation, requestHash },
        async () => {
          const role = await this.transactions.findActiveMemberRole(tx, workspaceId, userId);
          if (role !== 'OWNER' && !(allowEditor && role === 'EDITOR')) throw forbidden();
          return { status, body: await body(tx) };
        },
      );
    });
    return result.body;
  }

  private planView(plan: {
    id: string;
    name: string;
    amountMinor: bigint;
    recurrence: string;
    intervalMonths: number | null;
    startOn: Date;
    endOn: Date | null;
    categoryId: string | null;
    envelopeId: string | null;
    comment: string | null;
    isActive: boolean;
  }): ObligationPlanView {
    return {
      id: plan.id,
      planType: 'EXPENSE',
      name: plan.name,
      amountMinor: formatMinorUnits(plan.amountMinor),
      recurrence: plan.recurrence,
      intervalMonths: plan.intervalMonths,
      scheduledOn: isoDate(plan.startOn),
      endOn: plan.endOn ? isoDate(plan.endOn) : null,
      categoryId: plan.categoryId,
      envelopeId: plan.envelopeId,
      comment: plan.comment,
      status: plan.isActive ? 'ACTIVE' : 'ARCHIVED',
    };
  }

  private hash(value: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
