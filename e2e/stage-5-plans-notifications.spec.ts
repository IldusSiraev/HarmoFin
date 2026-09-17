import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { expect, test, type Page } from '@playwright/test';

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

test.describe('Stage 5 plans and notifications (CI-only)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('creates an expense plan, confirms its draft, and follows a notification', async ({
    page,
  }) => {
    const email = await registerAndReachApp(page);
    await initializeTemplate(page);
    await createAccount(page, 'Карта Stage 5', '50 000,00');
    await createEnvelope(page, 'Обязательства Stage 5', '50 000,00');
    await createExpensePlan(page);

    const occurrence = await seedOccurrence(email, 'Ипотека Stage 5');
    await page.goto('/app/plans');
    await expect(
      page.getByLabel('Ближайшие платежи').getByRole('heading', { name: 'Ипотека Stage 5' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Создать черновик' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );

    await page.getByRole('button', { name: 'Создать черновик' }).click();
    await expect(page).toHaveURL(/\/app\/operations\?draftId=/);
    await page.getByLabel('Сумма').fill('37 000,00');
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Подтвердить', exact: true })
      .click();
    await page.getByTestId('action-menu-trigger').first().click();
    await page.getByTestId('row-confirm').click();
    await page.locator('dialog[open] [data-confirm]').click();
    await expect(page.getByTestId('toast-stack')).toContainText('Операция подтверждена');

    await page.goto('/app/plans');
    await expect(page.getByText('Выполнено', { exact: true })).toBeVisible();

    const notificationId = await seedNotification(email, occurrence.id);
    await page.goto('/app/notifications');
    await page.getByRole('link', { name: 'Открыть' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/plans\\?occurrence=${occurrence.id}`));
    await expect
      .poll(
        async () =>
          (await prisma.notification.findUniqueOrThrow({ where: { id: notificationId } })).readAt,
      )
      .not.toBeNull();
  });
});

async function registerAndReachApp(page: Page): Promise<string> {
  const email = `stage-5-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

async function initializeTemplate(page: Page): Promise<void> {
  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Создать базовый шаблон' }).click();
  await expect(page.getByText('Базовый шаблон создан.')).toBeVisible();
}

async function createAccount(page: Page, name: string, balance: string): Promise<void> {
  await page.goto('/app/accounts');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill(name);
  await page.getByLabel('Начальный баланс').fill(balance);
  await page.getByLabel('Дата начала учёта').fill('2026-09-01');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(page.getByText(name)).toBeVisible();
}

async function createEnvelope(page: Page, name: string, balance: string): Promise<void> {
  await page.goto('/app/envelopes');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Создать конверт' }).first().click();
  await page.getByLabel('Название конверта').fill(name);
  await page.getByLabel('Начальный баланс').fill(balance);
  await page.getByLabel('Порядок отображения').fill('10');
  await page.getByRole('button', { name: 'Сохранить конверт' }).click();
  await expect(page.getByText(name)).toBeVisible();
}

async function createExpensePlan(page: Page): Promise<void> {
  await page.goto('/app/plans');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.locator('[data-action="create-plan"]').click();
  await expect(page.locator('input[name="name"]')).toBeVisible();
  await page.getByLabel('Название').fill('Ипотека Stage 5');
  await page.getByLabel('Сумма').fill('36 000,00');
  await page.getByLabel('Счёт по умолчанию').selectOption({ label: 'Карта Stage 5' });
  await page.getByLabel('Категория').selectOption({ label: 'Продукты' });
  await page.getByLabel('Конверт').selectOption({ label: 'Обязательства Stage 5' });
  await page.getByRole('button', { name: 'Сохранить план' }).click();
  await expect(page.getByText('План сохранён.')).toBeVisible();
}

async function seedOccurrence(email: string, planName: string) {
  const budget = await budgetFor(email);
  const plan = await prisma.regularPlan.findFirstOrThrow({
    where: { budgetId: budget.id, name: planName },
  });
  const existing = await prisma.planOccurrence.findFirst({
    where: { planId: plan.id, scheduledOn: plan.startOn, status: { not: 'CANCELLED' } },
  });
  if (existing) {
    return prisma.planOccurrence.update({ where: { id: existing.id }, data: { status: 'DUE' } });
  }
  return prisma.planOccurrence.create({
    data: {
      id: randomUUID(),
      workspaceId: budget.workspaceId,
      budgetId: budget.id,
      planId: plan.id,
      scheduledOn: plan.startOn,
      planName: plan.name,
      planType: plan.planType,
      amountMinor: plan.amountMinor,
      currency: plan.currency,
      scale: plan.scale,
      accountId: plan.accountId,
      categoryId: plan.categoryId,
      envelopeId: plan.envelopeId,
      comment: plan.comment,
      status: 'DUE',
    },
  });
}

async function seedNotification(email: string, occurrenceId: string): Promise<string> {
  const budget = await budgetFor(email);
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const id = randomUUID();
  await prisma.notification.create({
    data: {
      id,
      workspaceId: budget.workspaceId,
      budgetId: budget.id,
      userId: user.id,
      notificationType: 'PLAN_TODAY',
      occurrenceId,
      title: 'Платёж сегодня',
      body: 'Откройте выполненное возникновение.',
      actionPath: `/app/plans?occurrence=${occurrenceId}`,
      notificationKey: `e2e:${id}`,
    },
  });
  return id;
}

async function budgetFor(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return prisma.budget.findFirstOrThrow({
    where: { workspace: { ownerId: user.id } },
    select: { id: true, workspaceId: true },
  });
}
