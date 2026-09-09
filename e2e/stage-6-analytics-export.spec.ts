import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { PrismaClient } from '@prisma/client';
import { expect, test, type Download, type Page } from '@playwright/test';

const password = 'e2e-password-10';
const prisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ??
        'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
    },
  },
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe('Stage 6 analytics and CSV export (CI-only)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('shows typed analytics, downloads owner CSV, and hides export from editor', async ({
    browser,
    page,
  }) => {
    const ownerEmail = await registerAndReachApp(page);
    const seed = await seedStage6Data(ownerEmail);

    await page.goto('/app/analytics?report=plan-vs-actual');
    await expect(page.getByRole('heading', { name: 'План и факт' })).toBeVisible();
    await expect(page.getByText('Ипотека Stage 6')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Открыть журнал' })).toBeVisible();

    await page.goto('/app/analytics?report=savings-goals');
    await expect(page.getByRole('heading', { name: 'Цели накоплений' })).toBeVisible();
    await expect(page.getByText('Ремонт Stage 6')).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Прогресс: 500 из 1000',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );

    await page.goto('/app/operations?status=CONFIRMED');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Экспорт CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('harmofin-operations.csv');
    expect(await downloadText(download)).toContain(seed.transactionId);

    const editorContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
    try {
      const editorPage = await editorContext.newPage();
      const editorEmail = await registerAndReachApp(editorPage);
      const editor = await prisma.user.findUniqueOrThrow({
        where: { email: editorEmail },
        select: { id: true },
      });
      await moveEditorToWorkspace(editor.id, seed.workspaceId);
      await editorPage.goto('/app/operations');
      await expect(editorPage.getByRole('button', { name: 'Экспорт CSV' })).toHaveCount(0);
    } finally {
      await editorContext.close();
    }
  });
});

async function registerAndReachApp(page: Page): Promise<string> {
  const email = `stage-6-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

async function moveEditorToWorkspace(userId: string, workspaceId: string): Promise<void> {
  const editorWorkspace = await prisma.workspace.findFirstOrThrow({
    where: { ownerId: userId },
    select: { id: true, budgets: { select: { id: true } } },
  });
  const budgetIds = editorWorkspace.budgets.map((budget) => budget.id);
  await prisma.auditEvent.deleteMany({ where: { workspaceId: editorWorkspace.id } });
  await prisma.idempotencyRecord.deleteMany({ where: { budgetId: { in: budgetIds } } });
  await prisma.budget.deleteMany({ where: { id: { in: budgetIds } } });
  await prisma.workspaceMembership.deleteMany({ where: { workspaceId: editorWorkspace.id } });
  await prisma.workspace.delete({ where: { id: editorWorkspace.id } });
  await prisma.workspaceMembership.create({
    data: { id: randomUUID(), workspaceId, userId, role: 'EDITOR' },
  });
}

async function seedStage6Data(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const budget = await prisma.budget.findFirstOrThrow({
    where: { workspace: { ownerId: user.id } },
    select: { id: true, workspaceId: true },
  });
  const accountId = randomUUID();
  const categoryId = randomUUID();
  const expenseEnvelopeId = randomUUID();
  const goalEnvelopeId = randomUUID();
  const planId = randomUUID();
  const transactionId = randomUUID();
  const occurredOn = new Date('2026-09-10T00:00:00.000Z');

  await prisma.account.create({
    data: {
      id: accountId,
      budgetId: budget.id,
      name: 'Счёт Stage 6',
      accountType: 'CASH',
      startingBalanceMinor: 500_000n,
      accountingStartDate: occurredOn,
    },
  });
  await prisma.category.create({
    data: {
      id: categoryId,
      budgetId: budget.id,
      name: 'Ипотека Stage 6',
      categoryType: 'EXPENSE',
      displayOrder: 0,
    },
  });
  await prisma.envelope.createMany({
    data: [
      {
        id: expenseEnvelopeId,
        budgetId: budget.id,
        name: 'Обязательства Stage 6',
        envelopeType: 'MANDATORY_EXPENSES',
        startingBalanceMinor: 100_000n,
        displayOrder: 0,
      },
      {
        id: goalEnvelopeId,
        budgetId: budget.id,
        name: 'Ремонт Stage 6',
        envelopeType: 'SAVINGS_GOAL',
        startingBalanceMinor: 100_000n,
        targetAmountMinor: 200_000n,
        displayOrder: 1,
      },
    ],
  });
  await prisma.transaction.create({
    data: {
      id: transactionId,
      budgetId: budget.id,
      transactionType: 'EXPENSE',
      status: 'CONFIRMED',
      amountMinor: 90_000n,
      occurredOn,
      accountId,
      categoryId,
      envelopeId: expenseEnvelopeId,
      merchantName: 'Stage 6 export',
      confirmedAt: new Date(),
      createdByUserId: user.id,
      updatedByUserId: user.id,
    },
  });
  await prisma.regularPlan.create({
    data: {
      id: planId,
      workspaceId: budget.workspaceId,
      budgetId: budget.id,
      name: 'Ипотека Stage 6',
      planType: 'EXPENSE',
      amountMinor: 100_000n,
      anchorOn: occurredOn,
      startOn: occurredOn,
      recurrence: 'MONTHLY',
      accountId,
      categoryId,
      envelopeId: expenseEnvelopeId,
      createdByUserId: user.id,
      updatedByUserId: user.id,
    },
  });
  await prisma.planOccurrence.create({
    data: {
      id: randomUUID(),
      workspaceId: budget.workspaceId,
      budgetId: budget.id,
      planId,
      scheduledOn: occurredOn,
      planName: 'Ипотека Stage 6',
      planType: 'EXPENSE',
      amountMinor: 100_000n,
      accountId,
      categoryId,
      envelopeId: expenseEnvelopeId,
      status: 'COMPLETED',
      transactionId,
      completedAt: new Date(),
    },
  });

  return { budgetId: budget.id, workspaceId: budget.workspaceId, transactionId };
}

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('CSV download stream is unavailable.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream as Readable) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
