import { readFileSync } from 'node:fs';

import { NEW_BUDGET_TIMEZONE } from '../common/plan-model/new-budget-model.js';
import { describe, expect, it, vi } from 'vitest';

import { runSeed } from './seed.js';
import type { SeedDependencies } from './seed.js';

const validEnvironment = {
  NODE_ENV: 'test',
  SEED_DEMO_PASSWORD: 'demo-pass-10',
};

describe('runSeed', () => {
  it('rejects production before creating a database client', async () => {
    const createClient = vi.fn();

    await expect(
      runSeed({ ...validEnvironment, NODE_ENV: 'production' }, { createClient }),
    ).rejects.toThrow(/production/i);

    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects missing demo password before creating a database client', async () => {
    const createClient = vi.fn();

    await expect(runSeed({ NODE_ENV: 'test' }, { createClient })).rejects.toThrow(
      /SEED_DEMO_PASSWORD/,
    );

    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects a demo password shorter than 10 characters', async () => {
    const createClient = vi.fn();

    await expect(
      runSeed({ ...validEnvironment, SEED_DEMO_PASSWORD: '123456789' }, { createClient }),
    ).rejects.toThrow(/10/);

    expect(createClient).not.toHaveBeenCalled();
  });

  it('does not create Stage 2 defaults for an existing demo budget', async () => {
    const category = { create: vi.fn(), createMany: vi.fn(), upsert: vi.fn() };
    const envelope = { create: vi.fn(), createMany: vi.fn(), upsert: vi.fn() };
    const tx = {
      user: { upsert: vi.fn(async () => ({ id: '01800000-0000-7000-8000-000000000001' })) },
      workspace: { upsert: vi.fn(async () => ({ id: '01800000-0000-7000-8000-000000000002' })) },
      workspaceMembership: { upsert: vi.fn() },
      budget: { upsert: vi.fn(async () => ({ id: '01800000-0000-7000-8000-000000000003' })) },
      auditEvent: { upsert: vi.fn() },
      category,
      envelope,
    };
    const createClient = vi.fn(() => ({
      $transaction: async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
      $disconnect: vi.fn(),
    }));

    await runSeed(validEnvironment, {
      createClient: createClient as unknown as NonNullable<SeedDependencies['createClient']>,
    });

    expect(category.create).not.toHaveBeenCalled();
    expect(category.createMany).not.toHaveBeenCalled();
    expect(category.upsert).not.toHaveBeenCalled();
    expect(envelope.create).not.toHaveBeenCalled();
    expect(envelope.createMany).not.toHaveBeenCalled();
    expect(envelope.upsert).not.toHaveBeenCalled();
  });

  it('uses an injected client after accepting a valid environment', async () => {
    const tx = {
      user: { upsert: vi.fn(async () => ({ id: '01800000-0000-7000-8000-000000000001' })) },
      workspace: { upsert: vi.fn(async () => ({ id: '01800000-0000-7000-8000-000000000002' })) },
      workspaceMembership: { upsert: vi.fn() },
      budget: { upsert: vi.fn(async () => ({ id: '01800000-0000-7000-8000-000000000003' })) },
      auditEvent: { upsert: vi.fn() },
    };
    const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<void>) =>
      callback(tx),
    );
    const disconnect = vi.fn();
    const createClient = vi.fn(() => ({ $transaction: transaction, $disconnect: disconnect }));

    await expect(
      runSeed(validEnvironment, {
        createClient: createClient as unknown as NonNullable<SeedDependencies['createClient']>,
      }),
    ).resolves.toBeUndefined();

    expect(createClient).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('creates the demo budget in plan model 2 with an activation date (DB CHECK)', async () => {
    const budgetUpsert = vi.fn();
    budgetUpsert.mockResolvedValue({ id: '01800000-0000-7000-8000-000000000003' });
    const tx = {
      user: { upsert: vi.fn(async () => ({ id: '01800000-0000-7000-8000-000000000001' })) },
      workspace: { upsert: vi.fn(async () => ({ id: '01800000-0000-7000-8000-000000000002' })) },
      workspaceMembership: { upsert: vi.fn() },
      budget: { upsert: budgetUpsert },
      auditEvent: { upsert: vi.fn() },
    };
    const createClient = vi.fn(() => ({
      $transaction: async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
      $disconnect: vi.fn(),
    }));

    await runSeed(validEnvironment, {
      createClient: createClient as unknown as NonNullable<SeedDependencies['createClient']>,
    });

    const args = budgetUpsert.mock.calls[0]?.[0] as {
      create: { planModelVersion: number; planModelActivatedOn: Date };
      update: Record<string, unknown>;
    };
    expect(args.create.planModelVersion).toBe(2);
    expect(args.create.planModelActivatedOn).toBeInstanceOf(Date);
    expect(args.update).not.toHaveProperty('planModelVersion');
  });

  it('keeps NEW_BUDGET_TIMEZONE equal to the Prisma schema timezone default', () => {
    const schema = readFileSync(
      new URL('../../../../prisma/schema.prisma', import.meta.url),
      'utf8',
    );
    const budget = /model Budget \{[\s\S]*?^\}/m.exec(schema)?.[0] ?? '';
    const match = /timezone\s+String\s+@default\("([^"]+)"\)/.exec(budget);
    expect(match?.[1]).toBe(NEW_BUDGET_TIMEZONE);
  });
});
