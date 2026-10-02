import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const userId = randomUUID();
const workspaceId = randomUUID();
const budgetId = randomUUID();
const categoryId = randomUUID();
const planId = randomUUID();
const occurrenceId = randomUUID();
const occurrenceDate = new Date('2026-09-10T00:00:00.000Z');

async function createPlan() {
  await prisma.$executeRaw`
    INSERT INTO "regular_plans" (
      "id", "workspace_id", "budget_id", "name", "plan_type", "amount_minor",
      "currency", "scale", "anchor_on", "start_on", "recurrence", "category_id",
      "is_active", "created_by_user_id", "updated_by_user_id", "updated_at"
    )
    VALUES (
      ${planId}::uuid, ${workspaceId}::uuid, ${budgetId}::uuid, 'Зарплата', 'INCOME', 100000,
      'RUB', 2, ${occurrenceDate}::date, ${occurrenceDate}::date, 'ONE_TIME', ${categoryId}::uuid,
      TRUE, ${userId}::uuid, ${userId}::uuid, CURRENT_TIMESTAMP
    )
  `;
}

async function createOccurrence(id: string) {
  await prisma.$executeRaw`
    INSERT INTO "plan_occurrences" (
      "id", "workspace_id", "budget_id", "plan_id", "scheduled_on", "plan_name",
      "plan_type", "amount_minor", "currency", "scale", "category_id", "status", "created_at", "updated_at"
    )
    VALUES (
      ${id}::uuid, ${workspaceId}::uuid, ${budgetId}::uuid, ${planId}::uuid, ${occurrenceDate}::date,
      'Зарплата', 'INCOME', 100000, 'RUB', 2, ${categoryId}::uuid, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
}

describe('Stage 5 plans and notifications migration', () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `plans-migration-${userId}@harmofin.test`,
        passwordHash: 'test-hash',
      },
    });
    await prisma.workspace.create({ data: { id: workspaceId, ownerId: userId, name: 'Планы' } });
    await prisma.budget.create({
      data: { id: budgetId, workspaceId, name: 'Бюджет планов', planModelVersion: 1 },
    });
    await prisma.category.create({
      data: {
        id: categoryId,
        budgetId,
        name: 'Зарплата',
        categoryType: 'INCOME',
        displayOrder: 0,
      },
    });
  });

  afterAll(async () => {
    const [tables] = await prisma.$queryRaw<Array<{ regularPlans: string | null }>>`
      SELECT to_regclass('public.regular_plans')::text AS "regularPlans"
    `;
    if (tables?.regularPlans) {
      await prisma.$executeRaw`
        DELETE FROM "notifications" WHERE "budget_id" = ${budgetId}::uuid
      `;
      await prisma.$executeRaw`
        DELETE FROM "plan_occurrences" WHERE "budget_id" = ${budgetId}::uuid
      `;
      await prisma.$executeRaw`
        DELETE FROM "regular_plans" WHERE "budget_id" = ${budgetId}::uuid
      `;
    }
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.budget.delete({ where: { id: budgetId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('enforces one materialized occurrence per plan date', async () => {
    await createPlan();
    await createOccurrence(occurrenceId);

    await expect(createOccurrence(randomUUID())).rejects.toMatchObject({ code: 'P2010' });
  });

  it('allows only one unresolved negative-account warning for same account', async () => {
    const accountId = randomUUID();
    const create = (id: string) =>
      prisma.$executeRaw`
        INSERT INTO "notifications" (
          "id", "workspace_id", "budget_id", "user_id", "notification_type",
          "related_entity_type", "related_entity_id", "title", "body", "notification_key", "created_at", "updated_at"
        )
        VALUES (
          ${id}::uuid, ${workspaceId}::uuid, ${budgetId}::uuid, ${userId}::uuid, 'NEGATIVE_ACCOUNT',
          'account', ${accountId}::uuid, 'Отрицательный остаток', 'Проверьте остаток счёта.',
          ${`negative-account-${id}`}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
    const firstId = randomUUID();

    await create(firstId);
    await expect(create(randomUUID())).rejects.toMatchObject({ code: 'P2010' });
    await prisma.$executeRaw`
      UPDATE "notifications" SET "resolved_at" = CURRENT_TIMESTAMP WHERE "id" = ${firstId}::uuid
    `;
    await expect(create(randomUUID())).resolves.toBe(1);
  });
});
