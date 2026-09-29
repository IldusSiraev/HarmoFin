import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import { PlanModelPolicy } from '../common/plan-model/plan-model.policy.js';
import {
  forbidden,
  invalidReference,
  resourceNotFound,
} from '../common/reference-data/reference-data.errors.js';
import {
  EnvelopeReallocationRepository,
  type EnvelopeReallocationCreateData,
  type EnvelopeReallocationListQuery,
  type EnvelopeReallocationRecord,
} from './envelope-reallocation.repository.js';
import type {
  CreateEnvelopeReallocationInput,
  ListEnvelopeReallocationsInput,
} from './envelope-reallocation.schemas.js';

export interface EnvelopeReallocationView {
  [key: string]: unknown;
  id: string;
  budgetId: string;
  status: 'CONFIRMED' | 'DELETED';
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  occurredOn: string;
  comment: string | null;
  deletedAt: string | null;
  sourceEnvelopeCurrentBalanceMinor: string;
  destinationEnvelopeCurrentBalanceMinor: string;
}

export interface EnvelopeReallocationListView {
  items: EnvelopeReallocationView[];
  nextCursor: string | null;
}

@Injectable()
export class EnvelopeReallocationApplicationService {
  constructor(
    private readonly repository: EnvelopeReallocationRepository,
    private readonly idempotency: IdempotencyService,
    private readonly planModelPolicy?: PlanModelPolicy,
  ) {}

  async list(
    userId: string,
    budgetId: string,
    input: ListEnvelopeReallocationsInput,
  ): Promise<EnvelopeReallocationListView> {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const result = await this.repository.list(userId, budgetId, listQuery(input));
    return {
      items: result.items.map((record) => this.toView(record)),
      nextCursor: result.nextCursor,
    };
  }

  async get(userId: string, budgetId: string, id: string): Promise<EnvelopeReallocationView> {
    const record = await this.repository.find(userId, budgetId, id);
    if (!record) throw resourceNotFound();
    return this.toView(record);
  }

  async create(
    userId: string,
    budgetId: string,
    input: CreateEnvelopeReallocationInput,
    key: string,
    requestId?: string,
  ): Promise<EnvelopeReallocationView> {
    const budget = await this.requireMutationBudget(userId, budgetId);
    await this.requireBudgetPlanModel(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<EnvelopeReallocationView>(
        tx,
        idempotencyInput(budgetId, userId, key, 'envelope-reallocation.create', input),
        async () => {
          const data = await this.createData(
            tx,
            budgetId,
            userId,
            input,
            budget.allowNegativeBalance,
          );
          const record = await this.repository.create(tx, data, userId, requestId);
          return { status: 201, body: this.toView(record) };
        },
      );
      return result.body;
    });
  }

  async delete(
    userId: string,
    budgetId: string,
    id: string,
    key: string,
    requestId?: string,
  ): Promise<EnvelopeReallocationView> {
    await this.requireMutationBudget(userId, budgetId);
    await this.requireBudgetPlanModel(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<EnvelopeReallocationView>(
        tx,
        idempotencyInput(budgetId, userId, key, `envelope-reallocation.delete:${id}`, {}),
        async () => {
          const current = await this.requireMutableRecord(tx, userId, budgetId, id);
          if (current.status === 'DELETED') throw invalidState();
          const record = await this.repository.markDeleted(tx, current, userId, requestId);
          return { status: 200, body: this.toView(record) };
        },
      );
      return result.body;
    });
  }

  toView(record: EnvelopeReallocationRecord): EnvelopeReallocationView {
    return {
      id: record.id,
      budgetId: record.budgetId,
      status: record.status,
      sourceEnvelopeId: record.sourceEnvelopeId,
      destinationEnvelopeId: record.destinationEnvelopeId,
      amountMinor: formatMinorUnits(record.amountMinor),
      currency: 'RUB',
      scale: 2,
      occurredOn: record.occurredOn.toISOString().slice(0, 10),
      comment: record.comment,
      deletedAt: record.deletedAt?.toISOString() ?? null,
      sourceEnvelopeCurrentBalanceMinor: formatMinorUnits(record.sourceEnvelopeCurrentBalanceMinor),
      destinationEnvelopeCurrentBalanceMinor: formatMinorUnits(
        record.destinationEnvelopeCurrentBalanceMinor,
      ),
    };
  }

  private async createData(
    tx: Parameters<EnvelopeReallocationRepository['findActiveReferences']>[0],
    budgetId: string,
    userId: string,
    input: CreateEnvelopeReallocationInput,
    allowNegativeBalance: boolean,
  ): Promise<EnvelopeReallocationCreateData> {
    if (input.sourceEnvelopeId === input.destinationEnvelopeId) throw envelopesMustDiffer();
    const amountMinor = parsePositiveAmount(input.amount);

    const references = await this.repository.findActiveReferences(
      tx,
      budgetId,
      input.sourceEnvelopeId,
      input.destinationEnvelopeId,
    );
    if (
      !isActiveRubReference(references.sourceEnvelope) ||
      !isActiveRubReference(references.destinationEnvelope)
    ) {
      throw invalidReference();
    }

    if (!allowNegativeBalance) {
      const capacity = await this.repository.assertReallocationCapacity(
        tx,
        budgetId,
        input.sourceEnvelopeId,
        amountMinor,
      );
      if (!capacity) throw insufficientBalance();
    }

    return {
      budgetId,
      sourceEnvelopeId: input.sourceEnvelopeId,
      destinationEnvelopeId: input.destinationEnvelopeId,
      amountMinor,
      occurredOn: new Date(`${input.occurredOn}T00:00:00.000Z`),
      comment: input.comment ?? null,
      createdByUserId: userId,
      updatedByUserId: userId,
    };
  }

  private async requireMutationBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const role = budget.workspace.memberships[0]?.role;
    if (role !== 'OWNER' && role !== 'EDITOR') throw forbidden();
    return budget;
  }

  private async requireBudgetPlanModel(userId: string, budgetId: string): Promise<void> {
    const policy = this.planModelPolicy;
    if (policy) await policy.requireModel(userId, budgetId, 1);
  }

  private async requireMutableRecord(
    tx: Parameters<EnvelopeReallocationRepository['findForMutation']>[0],
    userId: string,
    budgetId: string,
    id: string,
  ): Promise<EnvelopeReallocationRecord> {
    const record = await this.repository.findForMutation(tx, userId, budgetId, id);
    if (!record) throw resourceNotFound();
    return record;
  }
}

function listQuery(input: ListEnvelopeReallocationsInput): EnvelopeReallocationListQuery {
  return {
    limit: input.limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.envelopeId ? { envelopeId: input.envelopeId } : {}),
    ...(input.from ? { from: new Date(`${input.from}T00:00:00.000Z`) } : {}),
    ...(input.to ? { to: new Date(`${input.to}T00:00:00.000Z`) } : {}),
  };
}

function idempotencyInput(
  budgetId: string,
  actorUserId: string,
  key: string,
  operation: string,
  body: unknown,
) {
  return {
    budgetId,
    actorUserId,
    key,
    operation,
    requestHash: createHash('sha256').update(JSON.stringify({ operation, body })).digest('hex'),
  };
}

function parsePositiveAmount(value: string): bigint {
  const amount = parseDecimalToMinorUnits(value, 2, false);
  if (amount <= 0n) throw invalidReference();
  return amount;
}

function isActiveRubReference(
  reference: { archivedAt: Date | null; currency: string; scale: number } | null,
): boolean {
  return reference?.archivedAt === null && reference.currency === 'RUB' && reference.scale === 2;
}

function envelopesMustDiffer(): BadRequestException {
  return new BadRequestException({
    code: 'ENVELOPE_REALLOCATION_ENVELOPES_MUST_DIFFER',
    detail: 'Конверт списания и конверт зачисления должны различаться.',
    fieldErrors: [
      {
        field: 'destinationEnvelopeId',
        message: 'Выберите другой конверт зачисления.',
        code: 'invalid',
      },
    ],
  });
}

function insufficientBalance(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'INSUFFICIENT_BALANCE',
    detail: 'Недостаточно средств в конверте списания.',
  });
}

function invalidState(): ConflictException {
  return new ConflictException({
    code: 'ENVELOPE_REALLOCATION_STATE_INVALID',
    detail: 'Перенос между конвертами уже удалён.',
  });
}
