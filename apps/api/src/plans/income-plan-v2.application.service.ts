import { createHash } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import {
  findPersonRefs,
  personRefOf,
  type PersonRef,
} from '../common/people/person-ref.repository.js';
import { findAccessActor, requireAccessActor } from '../common/policies/access-actor.repository.js';
import { BudgetAccessPolicy, type AccessActor } from '../common/policies/budget-access.policy.js';
import {
  invalidReference,
  resourceNotFound,
} from '../common/reference-data/reference-data.errors.js';
import { todayInTimezone } from '../cycles/cycle-period.domain.js';
import { nextPeriodEndAt } from '../cycles/cycle-settings-at.js';
import { PrismaService } from '../database/prisma.service.js';
import { ObligationPlanRepository } from '../obligations/obligation-plan.repository.js';
import { TransactionRepository } from '../transactions/transaction.repository.js';
import {
  TransactionV2ApplicationService,
  type TransactionV2View,
} from '../v2-transactions/transaction-v2.application.service.js';
import { IncomePlanRepository } from './income-plan-v2.repository.js';
import type {
  CreateIncomePlanInput,
  ListIncomeOccurrencesInput,
  ListIncomePlansInput,
  RecordIncomeInput,
  UpdateIncomePlanInput,
} from './income-plan-v2.schemas.js';
import { PlanOccurrenceRepository } from './plan-occurrence.repository.js';
import { RegularPlanRepository } from './regular-plan.repository.js';
import { V2OccurrenceMaterializer, creationHorizonEnd } from './v2-occurrence-materializer.js';

const RUB_SCALE = 2;

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

export type IncomePlanView = {
  id: string;
  planType: 'INCOME';
  name: string;
  amountMinor: string;
  recurrence: string;
  intervalMonths: number | null;
  scheduledOn: string;
  endOn: string | null;
  categoryId: string | null;
  comment: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  owner: PersonRef;
  canEdit: boolean;
};

export type IncomePlanCreateResult = IncomePlanView & {
  occurrenceId: string | null;
  occurrencesCreated: number;
};

export type IncomePlanUpdateResult = IncomePlanView & {
  updatedOccurrences: number;
  cancelledOccurrences: number;
};

export type IncomeOccurrenceListItem = {
  id: string;
  planId: string;
  name: string;
  scheduledOn: string;
  status: string;
  expectedMinor: string;
  categoryId: string | null;
  transactionId: string | null;
};

export type IncomeRecordResult = {
  occurrence: { id: string; status: 'COMPLETED'; transactionId: string };
  transaction: Omit<TransactionV2View, 'budgetId' | 'envelopeId' | 'warnings'>;
};

const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const dateValue = (value: string) => new Date(`${value}T00:00:00.000Z`);

function validationFailed(detail: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_FAILED', detail });
}

function occurrenceNotOpen(): ConflictException {
  return new ConflictException({
    code: 'OCCURRENCE_NOT_OPEN',
    detail: 'Прогноз дохода уже закрыт или отключён: повторная запись невозможна.',
  });
}

/**
 * v2 income plans: forecasts only. A planned income never creates a Transaction or an
 * EnvelopeAssignment and never counts in cash or mandatoryDue; only an explicit "record" creates
 * one confirmed v2 INCOME (O03 logic) and completes the occurrence atomically.
 * Creating a plan is open to any writer (OWNER or EDITOR); managing an existing plan (update)
 * and recording its income require object ownership, like the obligation side; every member may read.
 * Lock order: budget row -> idempotency advisory lock -> plan/occurrence rows -> account.
 */
@Injectable()
export class IncomePlanApplicationService {
  private readonly transactions: TransactionRepository;
  private readonly plans: RegularPlanRepository;
  private readonly planData = new IncomePlanRepository();
  private readonly planHelpers = new ObligationPlanRepository();
  private readonly occurrences = new PlanOccurrenceRepository();
  private readonly materializer: V2OccurrenceMaterializer;
  private readonly access = new BudgetAccessPolicy();

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy: PlanModelPolicy,
    private readonly incomes: TransactionV2ApplicationService,
  ) {
    this.transactions = new TransactionRepository(prisma);
    this.plans = new RegularPlanRepository(prisma);
    this.materializer = new V2OccurrenceMaterializer(this.plans, this.occurrences);
  }

  async listPlans(
    userId: string,
    budgetId: string,
    query: ListIncomePlansInput,
  ): Promise<{ items: IncomePlanView[] }> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const rows = await this.planData.listPlans(
      this.prisma,
      budgetId,
      query.status,
      query.ownerUserId,
    );
    const access = await findAccessActor(this.prisma, model.workspaceId, userId);
    const people = await findPersonRefs(
      this.prisma,
      model.workspaceId,
      rows.map((row) => row.ownerUserId),
    );
    return {
      items: rows.map((row) =>
        this.planView(
          row,
          personRefOf(people, row.ownerUserId),
          access !== null && this.access.canEditObject(access, row),
        ),
      ),
    };
  }

  async listOccurrences(
    userId: string,
    budgetId: string,
    query: ListIncomeOccurrencesInput,
  ): Promise<{ items: IncomeOccurrenceListItem[] }> {
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
        categoryId: row.categoryId,
        transactionId: row.transactionId,
      })),
    };
  }

  async createPlan(
    userId: string,
    budgetId: string,
    input: CreateIncomePlanInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<IncomePlanCreateResult> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const hash = this.hash({ budgetId, ...input, amount: input.amount.trim() });
    return this.run<IncomePlanCreateResult>(
      budgetId,
      userId,
      idempotencyKey,
      'income.plan.create',
      hash,
      model.workspaceId,
      201,
      async (tx, access) => {
        const amount = parseDecimalToMinorUnits(input.amount, RUB_SCALE, false);
        if (amount <= 0n) throw validationFailed('Сумма должна быть больше нуля.');
        const budget = await this.transactions.findBudgetSettings(tx, budgetId);
        if (!budget) throw resourceNotFound();
        const category = await this.planData.findIncomeCategory(tx, budgetId, input.categoryId);
        if (!category) throw resourceNotFound();
        if (category.categoryType !== 'INCOME') throw invalidReference();
        const activatedOn = model.planModelActivatedOn ? isoDate(model.planModelActivatedOn) : null;
        if (input.recurrence === 'ONE_TIME' && activatedOn && input.scheduledOn < activatedOn) {
          throw validationFailed('Дата разового дохода раньше даты запуска новой модели.');
        }

        const start = dateValue(input.scheduledOn);
        const plan = await this.plans.createPlan(
          tx,
          {
            workspaceId: model.workspaceId,
            budgetId,
            name: input.name,
            planType: 'INCOME',
            amountMinor: amount,
            anchorOn: start,
            startOn: start,
            endOn: input.endOn ? dateValue(input.endOn) : null,
            recurrence: input.recurrence,
            intervalMonths: input.intervalMonths ?? null,
            accountId: null,
            categoryId: category.id,
            envelopeId: null,
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
        const created = await this.materializer.ensureOccurrences(
          tx,
          budgetId,
          input.scheduledOn,
          to,
          { actorUserId: userId },
        );
        const occurrenceId = await this.planHelpers.findOccurrenceIdAt(
          tx,
          budgetId,
          plan.id,
          start,
        );
        const people = await findPersonRefs(tx, model.workspaceId, [userId]);
        return {
          ...this.planView(
            plan,
            personRefOf(people, userId),
            this.access.canEditObject(access, { ownerUserId: userId }),
          ),
          occurrenceId,
          occurrencesCreated: created,
        };
      },
      (access) => this.access.requireWriter(access),
    );
  }

  async updatePlan(
    userId: string,
    budgetId: string,
    planId: string,
    input: UpdateIncomePlanInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<IncomePlanUpdateResult> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const hash = this.hash({ budgetId, planId, ...input, amount: input.amount?.trim() });
    return this.run<IncomePlanUpdateResult>(
      budgetId,
      userId,
      idempotencyKey,
      'income.plan.update',
      hash,
      model.workspaceId,
      200,
      async (tx, access) => {
        const current = await this.plans.findPlanForMutation(tx, userId, budgetId, planId);
        if (!current || current.planType !== 'INCOME') throw resourceNotFound();
        const ownerUserId = await this.planData.findPlanOwnerUserId(tx, budgetId, planId);
        if (ownerUserId === null) throw resourceNotFound();
        this.access.requireObjectOwner(access, { ownerUserId });
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

        const scope = { id: budgetId, workspaceId: model.workspaceId };
        const today = todayInTimezone(new Date(), budget.timezone);
        const todayDate = dateValue(today);
        const renamed = input.name !== undefined && input.name !== current.name;
        const amountChanged = amount !== current.amountMinor;
        let updated = 0;
        let cancelled = 0;
        const updateExpected = async (ids: string[]) => {
          for (const id of ids) {
            if (
              await this.occurrences.updateOpenExpected(tx, budgetId, id, amount, userId, requestId)
            ) {
              updated += 1;
            }
          }
        };

        const futureIds = await this.planHelpers.findFutureUnpaidIds(
          tx,
          budgetId,
          planId,
          todayDate,
        );
        if (archiving) {
          cancelled = await this.planHelpers.cancelOccurrences(
            tx,
            scope,
            futureIds,
            userId,
            requestId,
          );
        } else if (current.isActive) {
          if (renamed) {
            await this.planHelpers.renameOccurrences(
              tx,
              scope,
              planId,
              futureIds,
              input.name!,
              userId,
              requestId,
            );
          }
          if (amountChanged) await updateExpected(futureIds);
          if (input.applyToCurrentOpen && amountChanged) {
            await updateExpected(
              await this.planHelpers.findCurrentOpenIds(tx, budgetId, planId, todayDate),
            );
          }
        }
        if (reactivating) {
          const restoredIds = await this.planHelpers.restoreDisabledOccurrences(
            tx,
            scope,
            planId,
            todayDate,
            userId,
            requestId,
          );
          if (renamed) {
            await this.planHelpers.renameOccurrences(
              tx,
              scope,
              planId,
              restoredIds,
              input.name!,
              userId,
              requestId,
            );
          }
          if (amountChanged) await updateExpected(restoredIds);
          await this.materializer.ensureOccurrences(
            tx,
            budgetId,
            today,
            await nextPeriodEndAt(tx, budgetId, today, budget),
            { actorUserId: userId },
          );
        }
        const people = await findPersonRefs(tx, model.workspaceId, [ownerUserId]);
        return {
          ...this.planView(
            plan,
            personRefOf(people, ownerUserId),
            this.access.canEditObject(access, { ownerUserId }),
          ),
          updatedOccurrences: updated,
          cancelledOccurrences: cancelled,
        };
      },
      (access) => this.access.requireWriter(access),
    );
  }

  /**
   * Records the actual income of a forecast occurrence: one confirmed v2 INCOME plus occurrence
   * completion in one transaction. A repeat is rejected by occurrence state, independent of the
   * Idempotency-Key. Assignment of the income stays a separate explicit action.
   */
  async recordIncome(
    userId: string,
    budgetId: string,
    occurrenceId: string,
    input: RecordIncomeInput,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<IncomeRecordResult> {
    const model = await this.planModelPolicy.requireModel(userId, budgetId, 2);
    const hash = this.hash({
      budgetId,
      occurrenceId,
      ...input,
      amount: input.amount.trim(),
      comment: input.comment ?? null,
    });
    return this.run<IncomeRecordResult>(
      budgetId,
      userId,
      idempotencyKey,
      'income.plan.record',
      hash,
      model.workspaceId,
      201,
      async (tx, access) => {
        await this.planData.lockOccurrence(tx, budgetId, occurrenceId);
        const occurrence = await this.planData.findOccurrence(tx, budgetId, occurrenceId);
        if (!occurrence) throw resourceNotFound();
        this.access.requireObjectOwner(access, { ownerUserId: occurrence.plan.ownerUserId });
        if (
          (occurrence.status !== 'PENDING' && occurrence.status !== 'DUE') ||
          occurrence.transactionId !== null ||
          !occurrence.plan.isActive ||
          occurrence.plan.deletedAt !== null
        ) {
          throw occurrenceNotOpen();
        }
        const categoryId = input.categoryId ?? occurrence.categoryId;
        if (!categoryId) throw validationFailed('Укажите категорию дохода.');

        const created = await this.incomes.createInTransaction(
          tx,
          userId,
          budgetId,
          model.workspaceId,
          {
            transactionType: 'INCOME',
            status: 'CONFIRMED',
            amount: input.amount,
            occurredOn: input.occurredOn,
            accountId: input.accountId,
            categoryId,
            envelopeId: null,
            comment: input.comment ?? null,
          },
          requestId,
        );
        const completed = await this.planData.completeWithTransaction(
          tx,
          { ...occurrence, budgetId },
          created.id,
          new Date(),
          userId,
          requestId,
        );
        if (!completed) throw occurrenceNotOpen();
        return {
          occurrence: { id: occurrence.id, status: 'COMPLETED', transactionId: created.id },
          transaction: {
            id: created.id,
            transactionType: created.transactionType,
            status: created.status,
            amountMinor: created.amountMinor,
            currency: created.currency,
            occurredOn: created.occurredOn,
            accountId: created.accountId,
            categoryId: created.categoryId,
            comment: created.comment,
            accountBalanceMinor: created.accountBalanceMinor,
          },
        };
      },
      (access) => this.access.requireWriter(access),
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
    body: (tx: Tx, access: AccessActor) => Promise<T>,
    authorize: (access: AccessActor) => void,
  ): Promise<T> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.transactions.lockBudget(tx, budgetId);
      return this.idempotency.execute<T>(
        tx,
        { budgetId, actorUserId: userId, key, operation, requestHash },
        async () => {
          const access = await requireAccessActor(tx, workspaceId, userId);
          authorize(access);
          return { status, body: await body(tx, access) };
        },
      );
    });
    return result.body;
  }

  private planView(
    plan: {
      id: string;
      name: string;
      amountMinor: bigint;
      recurrence: string;
      intervalMonths: number | null;
      startOn: Date;
      endOn: Date | null;
      categoryId: string | null;
      comment: string | null;
      isActive: boolean;
    },
    owner: PersonRef,
    canEdit: boolean,
  ): IncomePlanView {
    return {
      id: plan.id,
      planType: 'INCOME',
      name: plan.name,
      amountMinor: formatMinorUnits(plan.amountMinor),
      recurrence: plan.recurrence,
      intervalMonths: plan.intervalMonths,
      scheduledOn: isoDate(plan.startOn),
      endOn: plan.endOn ? isoDate(plan.endOn) : null,
      categoryId: plan.categoryId,
      comment: plan.comment,
      status: plan.isActive ? 'ACTIVE' : 'ARCHIVED',
      owner,
      canEdit,
    };
  }

  private hash(value: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
