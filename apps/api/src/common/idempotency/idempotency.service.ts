import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { createUuidV7 } from '../identifiers/uuid-v7.js';

export type IdempotencyInput = {
  budgetId: string;
  actorUserId: string;
  key: string;
  operation: string;
  requestHash: string;
};

type IdempotencyResult<T extends Record<string, unknown>> = {
  status: number;
  body: T;
};

function idempotencyLockKey(input: IdempotencyInput): string {
  return `${input.budgetId}:${input.actorUserId}:${input.key}`;
}

export class IdempotencyService {
  async execute<T extends Record<string, unknown>>(
    tx: Prisma.TransactionClient,
    input: IdempotencyInput,
    write: () => Promise<IdempotencyResult<T>>,
  ): Promise<IdempotencyResult<T>> {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLockKey(input)}, 0))
    `;

    const existing = await this.find(tx, input);
    if (existing) return this.replayOrConflict(existing, input);

    const result = await write();

    try {
      await tx.idempotencyRecord.create({
        data: {
          id: createUuidV7(),
          budgetId: input.budgetId,
          actorUserId: input.actorUserId,
          key: input.key,
          operation: input.operation,
          requestHash: input.requestHash,
          responseStatus: result.status,
          responseBody: result.body as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }

      const concurrent = await this.find(tx, input);
      if (!concurrent) throw error;
      return this.replayOrConflict(concurrent, input);
    }

    return result;
  }

  private find(tx: Prisma.TransactionClient, input: IdempotencyInput) {
    return tx.idempotencyRecord.findUnique({
      where: {
        budgetId_actorUserId_key: {
          budgetId: input.budgetId,
          actorUserId: input.actorUserId,
          key: input.key,
        },
      },
    });
  }

  private replayOrConflict<T extends Record<string, unknown>>(
    record: {
      operation: string;
      requestHash: string;
      responseStatus: number;
      responseBody: Prisma.JsonValue;
    },
    input: IdempotencyInput,
  ): IdempotencyResult<T> {
    if (record.operation !== input.operation || record.requestHash !== input.requestHash) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        detail: 'Ключ идемпотентности уже использован для другого запроса.',
      });
    }

    return { status: record.responseStatus, body: record.responseBody as T };
  }
}
