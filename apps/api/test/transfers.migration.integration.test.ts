import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FinancialBalanceRepository } from '../src/common/finance/financial-balance.repository.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const stageOneMigrationPath = fileURLToPath(
  new URL('../../../prisma/migrations/20260831000000_init/migration.sql', import.meta.url),
);
const stageTwoMigrationPath = fileURLToPath(
  new URL(
    '../../../prisma/migrations/20260902000000_stage_2_reference_data/migration.sql',
    import.meta.url,
  ),
);
const stageThreeMigrationPath = fileURLToPath(
  new URL(
    '../../../prisma/migrations/20260904000000_stage_3a_operations/migration.sql',
    import.meta.url,
  ),
);
const stageFourMigrationPath = fileURLToPath(
  new URL(
    '../../../prisma/migrations/20260905000000_stage_4_transfers/migration.sql',
    import.meta.url,
  ),
);
const upgradeSchema = `transfer_migration_${randomUUID().replaceAll('-', '')}`;
const upgradeClient = new Client({ connectionString: databaseUrl });
const userId = randomUUID();
const workspaceId = randomUUID();
const budgetId = randomUUID();
const otherBudgetId = randomUUID();
const sourceAccountId = randomUUID();
const destinationAccountId = randomUUID();
const sourceEnvelopeId = randomUUID();
const destinationEnvelopeId = randomUUID();
const otherAccountId = randomUUID();
const otherEnvelopeId = randomUUID();
let currentFixtureCreated = false;
let upgradeClientConnected = false;

async function createCurrentReferences(
  targetBudgetId: string,
  ids: {
    sourceAccountId: string;
    destinationAccountId: string;
    sourceEnvelopeId: string;
    destinationEnvelopeId: string;
  },
) {
  await prisma.account.createMany({
    data: [
      {
        id: ids.sourceAccountId,
        budgetId: targetBudgetId,
        name: `Исходный счёт ${ids.sourceAccountId}`,
        accountType: 'CASH',
        startingBalanceMinor: 10_000n,
        accountingStartDate: new Date('2026-09-05'),
      },
      {
        id: ids.destinationAccountId,
        budgetId: targetBudgetId,
        name: `Целевой счёт ${ids.destinationAccountId}`,
        accountType: 'BANK_ACCOUNT',
        startingBalanceMinor: 10_000n,
        accountingStartDate: new Date('2026-09-05'),
      },
    ],
  });
  await prisma.envelope.createMany({
    data: [
      {
        id: ids.sourceEnvelopeId,
        budgetId: targetBudgetId,
        name: `Исходный конверт ${ids.sourceEnvelopeId}`,
        envelopeType: 'CUSTOM',
        startingBalanceMinor: 10_000n,
        displayOrder: 0,
      },
      {
        id: ids.destinationEnvelopeId,
        budgetId: targetBudgetId,
        name: `Целевой конверт ${ids.destinationEnvelopeId}`,
        envelopeType: 'CUSTOM',
        startingBalanceMinor: 0n,
        displayOrder: 1,
      },
    ],
  });
}

async function createTransfer({
  totalMinor,
  parts,
}: {
  totalMinor: bigint;
  parts: Array<{
    sourceAccountId: string;
    destinationAccountId: string;
    sourceEnvelopeId: string;
    destinationEnvelopeId: string;
    amountMinor: bigint;
  }>;
}) {
  const transfer = await prisma.transfer.create({
    data: {
      id: randomUUID(),
      budgetId,
      status: 'CONFIRMED',
      totalMinor,
      occurredOn: new Date('2026-09-05'),
      confirmedAt: new Date('2026-09-05T12:00:00.000Z'),
      createdByUserId: userId,
      updatedByUserId: userId,
    },
  });

  await prisma.transferPart.createMany({
    data: parts.map((part) => ({
      id: randomUUID(),
      transferId: transfer.id,
      budgetId,
      ...part,
    })),
  });

  return transfer;
}

async function currentBalances() {
  const balances = new FinancialBalanceRepository();

  return prisma.$transaction(async (tx) => ({
    sourceAccount: await balances.accountBalance(tx, budgetId, sourceAccountId),
    destinationAccount: await balances.accountBalance(tx, budgetId, destinationAccountId),
    sourceEnvelope: await balances.envelopeBalance(tx, budgetId, sourceEnvelopeId),
    destinationEnvelope: await balances.envelopeBalance(tx, budgetId, destinationEnvelopeId),
  }));
}

describe('Stage 4 transfer migration', () => {
  beforeAll(async () => {
    const [stageOneMigration, stageTwoMigration, stageThreeMigration, stageFourMigration] =
      await Promise.all([
        readFile(stageOneMigrationPath, 'utf8'),
        readFile(stageTwoMigrationPath, 'utf8'),
        readFile(stageThreeMigrationPath, 'utf8'),
        readFile(stageFourMigrationPath, 'utf8'),
      ]);

    await upgradeClient.connect();
    upgradeClientConnected = true;
    await upgradeClient.query(`CREATE SCHEMA ${upgradeSchema}`);
    await upgradeClient.query(`SET search_path TO ${upgradeSchema}`);
    await upgradeClient.query(stageOneMigration);
    await upgradeClient.query(stageTwoMigration);
    await upgradeClient.query(
      `INSERT INTO "users" ("id", "email", "password_hash", "updated_at")
       VALUES ($1, $2, 'test-password-hash', CURRENT_TIMESTAMP)`,
      [userId, `legacy-transfer-${userId}@harmofin.test`],
    );
    await upgradeClient.query(
      `INSERT INTO "workspaces" ("id", "owner_id", "name", "updated_at")
       VALUES ($1, $2, 'Существующее пространство', CURRENT_TIMESTAMP)`,
      [workspaceId, userId],
    );
    await upgradeClient.query(
      `INSERT INTO "budgets" ("id", "workspace_id", "name", "updated_at")
       VALUES ($1, $2, 'Существующий бюджет', CURRENT_TIMESTAMP)`,
      [budgetId, workspaceId],
    );
    await upgradeClient.query(
      `INSERT INTO "accounts" (
         "id", "budget_id", "name", "account_type", "starting_balance_minor", "accounting_start_date", "updated_at"
       ) VALUES ($1, $2, 'Старый счёт', 'CASH', 10000, DATE '2026-09-05', CURRENT_TIMESTAMP)`,
      [sourceAccountId, budgetId],
    );
    await upgradeClient.query(
      `INSERT INTO "categories" (
         "id", "budget_id", "name", "category_type", "display_order", "updated_at"
       ) VALUES ($1, $2, 'Старый доход', 'INCOME', 0, CURRENT_TIMESTAMP)`,
      [destinationAccountId, budgetId],
    );
    await upgradeClient.query(
      `INSERT INTO "envelopes" (
         "id", "budget_id", "name", "envelope_type", "starting_balance_minor", "display_order", "updated_at"
       ) VALUES ($1, $2, 'Старый конверт', 'CUSTOM', 0, 0, CURRENT_TIMESTAMP)`,
      [sourceEnvelopeId, budgetId],
    );
    await upgradeClient.query(stageThreeMigration);
    await upgradeClient.query(
      `INSERT INTO "transactions" (
         "id", "budget_id", "transaction_type", "status", "amount_minor", "occurred_on", "account_id", "category_id",
         "confirmed_at", "created_by_user_id", "updated_by_user_id", "updated_at"
       ) VALUES ($1, $2, 'INCOME', 'CONFIRMED', 10000, DATE '2026-09-05', $3, $4,
         CURRENT_TIMESTAMP, $5, $5, CURRENT_TIMESTAMP)`,
      [randomUUID(), budgetId, sourceAccountId, destinationAccountId, userId],
    );
    await upgradeClient.query(stageFourMigration);
  });

  afterAll(async () => {
    if (currentFixtureCreated) {
      await prisma.transferPart.deleteMany({
        where: { budgetId: { in: [budgetId, otherBudgetId] } },
      });
      await prisma.transfer.deleteMany({ where: { budgetId: { in: [budgetId, otherBudgetId] } } });
      await prisma.account.deleteMany({ where: { budgetId: { in: [budgetId, otherBudgetId] } } });
      await prisma.envelope.deleteMany({ where: { budgetId: { in: [budgetId, otherBudgetId] } } });
      await prisma.budget.deleteMany({ where: { id: { in: [budgetId, otherBudgetId] } } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();

    if (upgradeClientConnected) {
      await upgradeClient.query(`DROP SCHEMA IF EXISTS ${upgradeSchema} CASCADE`);
      await upgradeClient.end();
    }
  });

  it('upgrades Stage 1–3a fixture data without losing rows', async () => {
    const result = await upgradeClient.query<{
      transactionCount: string;
      transferTable: string | null;
    }>(
      `SELECT
         (SELECT count(*)::text FROM "transactions") AS "transactionCount",
         to_regclass('transfer_parts')::text AS "transferTable"`,
    );

    expect(result.rows).toEqual([{ transactionCount: '1', transferTable: 'transfer_parts' }]);
  });

  it('persists one-part and multipart transfers through Prisma', async () => {
    currentFixtureCreated = true;
    await prisma.user.create({
      data: {
        id: userId,
        email: `current-transfer-${userId}@harmofin.test`,
        passwordHash: 'test-hash',
      },
    });
    await prisma.workspace.create({ data: { id: workspaceId, ownerId: userId, name: 'Переводы' } });
    await prisma.budget.create({ data: { id: budgetId, workspaceId, name: 'Первый бюджет' } });
    await createCurrentReferences(budgetId, {
      sourceAccountId,
      destinationAccountId,
      sourceEnvelopeId,
      destinationEnvelopeId,
    });

    await createTransfer({
      totalMinor: 2_500n,
      parts: [
        {
          sourceAccountId,
          destinationAccountId,
          sourceEnvelopeId,
          destinationEnvelopeId: sourceEnvelopeId,
          amountMinor: 2_500n,
        },
      ],
    });
    await expect(currentBalances()).resolves.toEqual({
      sourceAccount: 7_500n,
      destinationAccount: 12_500n,
      sourceEnvelope: 10_000n,
      destinationEnvelope: 0n,
    });

    await createTransfer({
      totalMinor: 5_000n,
      parts: [
        {
          sourceAccountId,
          destinationAccountId,
          sourceEnvelopeId,
          destinationEnvelopeId: sourceEnvelopeId,
          amountMinor: 2_500n,
        },
        {
          sourceAccountId,
          destinationAccountId,
          sourceEnvelopeId,
          destinationEnvelopeId,
          amountMinor: 2_500n,
        },
      ],
    });
    await expect(currentBalances()).resolves.toEqual({
      sourceAccount: 2_500n,
      destinationAccount: 17_500n,
      sourceEnvelope: 7_500n,
      destinationEnvelope: 2_500n,
    });

    await expect(prisma.transfer.count({ where: { budgetId } })).resolves.toBe(2);
    await expect(prisma.transferPart.count({ where: { budgetId } })).resolves.toBe(3);
  });

  it('rejects zero parts and cross-budget references at database boundary', async () => {
    await prisma.budget.create({ data: { id: otherBudgetId, workspaceId, name: 'Другой бюджет' } });
    await createCurrentReferences(otherBudgetId, {
      sourceAccountId: otherAccountId,
      destinationAccountId: randomUUID(),
      sourceEnvelopeId: otherEnvelopeId,
      destinationEnvelopeId: randomUUID(),
    });
    const transfer = await createTransfer({
      totalMinor: 1n,
      parts: [
        {
          sourceAccountId,
          destinationAccountId,
          sourceEnvelopeId,
          destinationEnvelopeId: sourceEnvelopeId,
          amountMinor: 1n,
        },
      ],
    });

    await expect(
      prisma.transferPart.create({
        data: {
          id: randomUUID(),
          transferId: transfer.id,
          budgetId,
          sourceAccountId,
          destinationAccountId,
          sourceEnvelopeId,
          destinationEnvelopeId: sourceEnvelopeId,
          amountMinor: 0n,
        },
      }),
    ).rejects.toThrow('violates check constraint');
    await expect(
      prisma.transferPart.create({
        data: {
          id: randomUUID(),
          transferId: transfer.id,
          budgetId,
          sourceAccountId: otherAccountId,
          destinationAccountId,
          sourceEnvelopeId,
          destinationEnvelopeId: sourceEnvelopeId,
          amountMinor: 1n,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
