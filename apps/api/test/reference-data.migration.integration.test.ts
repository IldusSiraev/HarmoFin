import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
const upgradeSchema = `reference_data_migration_${randomUUID().replaceAll('-', '')}`;
const upgradeClient = new Client({ connectionString: databaseUrl });
const currentUserId = randomUUID();
const currentWorkspaceId = randomUUID();
const currentBudgetId = randomUUID();
const legacyUserId = randomUUID();
const legacyWorkspaceId = randomUUID();
const legacyBudgetId = randomUUID();
const otherWorkspaceId = randomUUID();
const otherBudgetId = randomUUID();

async function insertCategory({
  id = randomUUID(),
  budgetId = legacyBudgetId,
  name = `Категория ${randomUUID()}`,
  type = 'EXPENSE',
  templateKey = null,
  parentId = null,
}: {
  id?: string;
  budgetId?: string;
  name?: string;
  type?: 'INCOME' | 'EXPENSE';
  templateKey?: string | null;
  parentId?: string | null;
}) {
  await upgradeClient.query(
    `INSERT INTO "categories" (
       "id", "budget_id", "template_key", "name", "category_type", "parent_id", "display_order", "updated_at"
     ) VALUES ($1, $2, $3, $4, $5, $6, 0, CURRENT_TIMESTAMP)`,
    [id, budgetId, templateKey, name, type, parentId],
  );
  return id;
}

async function insertEnvelope({
  id = randomUUID(),
  budgetId = legacyBudgetId,
  name = `Конверт ${randomUUID()}`,
  templateKey = null,
}: {
  id?: string;
  budgetId?: string;
  name?: string;
  templateKey?: string | null;
}) {
  await upgradeClient.query(
    `INSERT INTO "envelopes" (
       "id", "budget_id", "template_key", "name", "envelope_type", "starting_balance_minor", "display_order", "updated_at"
     ) VALUES ($1, $2, $3, $4, 'CUSTOM', 0, 0, CURRENT_TIMESTAMP)`,
    [id, budgetId, templateKey, name],
  );
  return id;
}

async function insertAccount({
  id = randomUUID(),
  budgetId = legacyBudgetId,
  name = `Счёт ${randomUUID()}`,
}: {
  id?: string;
  budgetId?: string;
  name?: string;
}) {
  await upgradeClient.query(
    `INSERT INTO "accounts" (
       "id", "budget_id", "name", "account_type", "starting_balance_minor", "accounting_start_date", "updated_at"
     ) VALUES ($1, $2, $3, 'CASH', 0, CURRENT_DATE, CURRENT_TIMESTAMP)`,
    [id, budgetId, name],
  );
  return id;
}

describe('reference data migration', () => {
  beforeAll(async () => {
    const stageOneMigration = await readFile(stageOneMigrationPath, 'utf8');
    const stageTwoMigration = await readFile(stageTwoMigrationPath, 'utf8');

    await upgradeClient.connect();
    await upgradeClient.query(`CREATE SCHEMA ${upgradeSchema}`);
    await upgradeClient.query(`SET search_path TO ${upgradeSchema}`);
    await upgradeClient.query(stageOneMigration);

    await upgradeClient.query(
      `INSERT INTO "users" ("id", "email", "password_hash", "updated_at")
       VALUES ($1, $2, 'test-password-hash', CURRENT_TIMESTAMP)`,
      [legacyUserId, `legacy-${legacyUserId}@harmofin.test`],
    );
    await upgradeClient.query(
      `INSERT INTO "workspaces" ("id", "owner_id", "name", "updated_at")
       VALUES ($1, $2, 'Существующее пространство', CURRENT_TIMESTAMP)`,
      [legacyWorkspaceId, legacyUserId],
    );
    await upgradeClient.query(
      `INSERT INTO "budgets" ("id", "workspace_id", "name", "updated_at")
       VALUES ($1, $2, 'Существующий бюджет', CURRENT_TIMESTAMP)`,
      [legacyBudgetId, legacyWorkspaceId],
    );
    await upgradeClient.query(
      `INSERT INTO "workspaces" ("id", "owner_id", "name", "updated_at")
       VALUES ($1, $2, 'Другое пространство', CURRENT_TIMESTAMP)`,
      [otherWorkspaceId, legacyUserId],
    );
    await upgradeClient.query(
      `INSERT INTO "budgets" ("id", "workspace_id", "name", "updated_at")
       VALUES ($1, $2, 'Другой бюджет', CURRENT_TIMESTAMP)`,
      [otherBudgetId, otherWorkspaceId],
    );

    await upgradeClient.query(stageTwoMigration);
  });

  afterAll(async () => {
    await prisma.envelope.deleteMany({ where: { budgetId: currentBudgetId } });
    await prisma.category.deleteMany({ where: { budgetId: currentBudgetId } });
    await prisma.account.deleteMany({ where: { budgetId: currentBudgetId } });
    await prisma.budget.deleteMany({ where: { id: currentBudgetId } });
    await prisma.workspace.deleteMany({ where: { id: currentWorkspaceId } });
    await prisma.user.deleteMany({ where: { id: currentUserId } });
    await prisma.$disconnect();

    await upgradeClient.query(`DROP SCHEMA IF EXISTS ${upgradeSchema} CASCADE`);
    await upgradeClient.end();
  });

  it('upgrades a Stage 1 budget with defaults and no implicit reference data', async () => {
    const budget = await upgradeClient.query<{
      timezone: string;
      incomeAllocationRuleEnabled: boolean;
      incomeAllocationSourceCategoryId: string | null;
      incomeAllocationTargetEnvelopeId: string | null;
    }>(
      `SELECT
         "timezone",
         "income_allocation_rule_enabled" AS "incomeAllocationRuleEnabled",
         "income_allocation_source_category_id" AS "incomeAllocationSourceCategoryId",
         "income_allocation_target_envelope_id" AS "incomeAllocationTargetEnvelopeId"
       FROM "budgets"
       WHERE "id" = $1`,
      [legacyBudgetId],
    );
    const categoryCount = await upgradeClient.query<{ count: string }>(
      'SELECT count(*) FROM "categories" WHERE "budget_id" = $1',
      [legacyBudgetId],
    );
    const envelopeCount = await upgradeClient.query<{ count: string }>(
      'SELECT count(*) FROM "envelopes" WHERE "budget_id" = $1',
      [legacyBudgetId],
    );

    expect(budget.rows).toEqual([
      {
        timezone: 'Europe/Moscow',
        incomeAllocationRuleEnabled: false,
        incomeAllocationSourceCategoryId: null,
        incomeAllocationTargetEnvelopeId: null,
      },
    ]);
    expect(categoryCount.rows[0]?.count).toBe('0');
    expect(envelopeCount.rows[0]?.count).toBe('0');
  });

  it('enforces Stage 2 constraints at the database boundary', async () => {
    await expect(
      upgradeClient.query(
        `INSERT INTO "accounts" (
           "id", "budget_id", "name", "account_type", "currency", "starting_balance_minor", "accounting_start_date", "updated_at"
         ) VALUES ($1, $2, 'Валюта', 'CASH', 'USD', 0, CURRENT_DATE, CURRENT_TIMESTAMP)`,
        [randomUUID(), legacyBudgetId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      upgradeClient.query(
        `INSERT INTO "accounts" (
           "id", "budget_id", "name", "account_type", "scale", "starting_balance_minor", "accounting_start_date", "updated_at"
         ) VALUES ($1, $2, 'Масштаб', 'CASH', 3, 0, CURRENT_DATE, CURRENT_TIMESTAMP)`,
        [randomUUID(), legacyBudgetId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      upgradeClient.query(
        `INSERT INTO "envelopes" (
           "id", "budget_id", "name", "envelope_type", "starting_balance_minor", "target_date", "display_order", "updated_at"
         ) VALUES ($1, $2, 'Цель без суммы', 'SAVINGS_GOAL', 0, DATE '2026-12-31', 0, CURRENT_TIMESTAMP)`,
        [randomUUID(), legacyBudgetId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    const archivedAccountId = await insertAccount({ name: 'Накопления' });
    await expect(insertAccount({ name: 'накопления' })).rejects.toMatchObject({ code: '23505' });
    await upgradeClient.query(
      'UPDATE "accounts" SET "archived_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
      [archivedAccountId],
    );
    await expect(insertAccount({ name: 'накопления' })).resolves.toEqual(expect.any(String));

    const archivedCategoryId = await insertCategory({ name: 'Продукты' });
    await expect(insertCategory({ name: 'продукты' })).rejects.toMatchObject({ code: '23505' });
    await upgradeClient.query(
      'UPDATE "categories" SET "archived_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
      [archivedCategoryId],
    );
    await expect(insertCategory({ name: 'продукты' })).resolves.toEqual(expect.any(String));

    const archivedEnvelopeId = await insertEnvelope({ name: 'Резерв' });
    await expect(insertEnvelope({ name: 'резерв' })).rejects.toMatchObject({ code: '23505' });
    await upgradeClient.query(
      'UPDATE "envelopes" SET "archived_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
      [archivedEnvelopeId],
    );
    await expect(insertEnvelope({ name: 'резерв' })).resolves.toEqual(expect.any(String));

    await insertCategory({ name: 'Без шаблона 1' });
    await expect(insertCategory({ name: 'Без шаблона 2' })).resolves.toEqual(expect.any(String));
    await insertCategory({ name: 'Шаблон категории', templateKey: 'food' });
    await expect(
      insertCategory({ name: 'Дубликат шаблона', templateKey: 'food' }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      insertCategory({
        budgetId: otherBudgetId,
        name: 'Шаблон другого бюджета',
        templateKey: 'food',
      }),
    ).resolves.toEqual(expect.any(String));

    await insertEnvelope({ name: 'Шаблон конверта', templateKey: 'reserve' });
    await expect(
      insertEnvelope({ name: 'Дубликат шаблона конверта', templateKey: 'reserve' }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      insertEnvelope({
        budgetId: otherBudgetId,
        name: 'Шаблон другого конверта',
        templateKey: 'reserve',
      }),
    ).resolves.toEqual(expect.any(String));

    const otherCategoryId = await insertCategory({ budgetId: otherBudgetId });
    const otherEnvelopeId = await insertEnvelope({ budgetId: otherBudgetId });
    await expect(insertCategory({ parentId: otherCategoryId })).rejects.toMatchObject({
      code: '23503',
    });
    await expect(
      upgradeClient.query(
        'UPDATE "budgets" SET "income_allocation_source_category_id" = $1 WHERE "id" = $2',
        [otherCategoryId, legacyBudgetId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      upgradeClient.query(
        'UPDATE "budgets" SET "income_allocation_target_envelope_id" = $1 WHERE "id" = $2',
        [otherEnvelopeId, legacyBudgetId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('uses Stage 2 defaults for a current-schema budget without implicit reference data', async () => {
    await prisma.user.create({
      data: {
        id: currentUserId,
        email: `current-${currentUserId}@harmofin.test`,
        passwordHash: 'test-password-hash',
      },
    });
    await prisma.workspace.create({
      data: { id: currentWorkspaceId, ownerId: currentUserId, name: 'Текущее пространство' },
    });
    const budget = await prisma.budget.create({
      data: { id: currentBudgetId, workspaceId: currentWorkspaceId, name: 'Текущий бюджет' },
    });

    expect(budget).toMatchObject({
      timezone: 'Europe/Moscow',
      incomeAllocationRuleEnabled: false,
      incomeAllocationSourceCategoryId: null,
      incomeAllocationTargetEnvelopeId: null,
    });
    await expect(prisma.category.count({ where: { budgetId: currentBudgetId } })).resolves.toBe(0);
    await expect(prisma.envelope.count({ where: { budgetId: currentBudgetId } })).resolves.toBe(0);
  });
});
