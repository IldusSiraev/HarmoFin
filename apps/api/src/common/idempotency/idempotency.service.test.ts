import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { IdempotencyService, type IdempotencyInput } from './idempotency.service.js';

describe('IdempotencyService', () => {
  const input: IdempotencyInput = {
    budgetId: '00000000-0000-4000-8000-000000000001',
    actorUserId: '00000000-0000-4000-8000-000000000002',
    key: 'retry-key',
    operation: 'transaction.create',
    requestHash: 'a'.repeat(64),
  };

  it('locks matching idempotency identities before executing financial mutation', async () => {
    let releaseLock: (() => void) | undefined;
    const tx = transactionClient({
      findUnique: vi.fn().mockResolvedValue(null),
      queryRaw: vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseLock = resolve;
          }),
      ),
    });
    const write = vi.fn().mockResolvedValue({ status: 201, body: { id: 'operation-id' } });

    const execution = new IdempotencyService().execute(tx, input, write);

    expect(tx.idempotencyRecord.findUnique).not.toHaveBeenCalled();
    releaseLock?.();
    await execution;
    expect(write).toHaveBeenCalledOnce();
  });

  it('returns saved result for a matching idempotency retry', async () => {
    const tx = transactionClient({
      findUnique: vi.fn().mockResolvedValue({
        operation: input.operation,
        requestHash: input.requestHash,
        responseStatus: 201,
        responseBody: { id: 'operation-id', status: 'CONFIRMED' },
      }),
    });
    const write = vi.fn();

    const result = await new IdempotencyService().execute(tx, input, write);

    expect(result).toEqual({ status: 201, body: { id: 'operation-id', status: 'CONFIRMED' } });
    expect(write).not.toHaveBeenCalled();
  });

  it('saves result after executing a new financial mutation once', async () => {
    const create = vi.fn().mockResolvedValue({});
    const tx = transactionClient({ findUnique: vi.fn().mockResolvedValue(null), create });
    const write = vi.fn().mockResolvedValue({ status: 201, body: { id: 'operation-id' } });

    await expect(new IdempotencyService().execute(tx, input, write)).resolves.toEqual({
      status: 201,
      body: { id: 'operation-id' },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        budgetId: input.budgetId,
        actorUserId: input.actorUserId,
        key: input.key,
        operation: input.operation,
        requestHash: input.requestHash,
        responseStatus: 201,
        responseBody: { id: 'operation-id' },
      }),
    });
  });

  it('rejects same idempotency key with a different request fingerprint', async () => {
    const tx = transactionClient({
      findUnique: vi.fn().mockResolvedValue({
        operation: input.operation,
        requestHash: input.requestHash,
        responseStatus: 201,
        responseBody: { id: 'operation-id' },
      }),
    });

    await expect(
      new IdempotencyService().execute(tx, { ...input, requestHash: 'b'.repeat(64) }, async () => ({
        status: 201,
        body: { id: 'different-operation' },
      })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
    });
  });

  it('replays matching saved result after concurrent unique-key creation', async () => {
    const create = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed.', {
        code: 'P2002',
        clientVersion: '6.19.0',
      }),
    );
    const tx = transactionClient({
      findUnique: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          operation: input.operation,
          requestHash: input.requestHash,
          responseStatus: 201,
          responseBody: { id: 'operation-id' },
        }),
      create,
    });

    await expect(
      new IdempotencyService().execute(tx, input, async () => ({
        status: 201,
        body: { id: 'operation-id' },
      })),
    ).resolves.toEqual({ status: 201, body: { id: 'operation-id' } });
  });

  function transactionClient(overrides: {
    findUnique: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
    queryRaw?: ReturnType<typeof vi.fn>;
  }) {
    return {
      $queryRaw: overrides.queryRaw ?? vi.fn().mockResolvedValue([]),
      idempotencyRecord: {
        findUnique: overrides.findUnique,
        create: overrides.create ?? vi.fn(),
      },
    } as unknown as Prisma.TransactionClient;
  }
});
