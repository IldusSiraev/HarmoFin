import { expect, test, type Page } from '@playwright/test';
import { apiV1 } from './env';

const password = 'e2e-password-10';

test('new owner completes every onboarding step from the dashboard checklist', async ({ page }) => {
  test.setTimeout(90_000);
  await registerAndReachApp(page);

  await expect(page.getByTestId('onboarding-checklist')).toBeVisible();
  await expect(page.getByTestId('onboarding-step')).toHaveCount(5);
  await expect(page.getByTestId('onboarding-step-done')).toHaveCount(0);

  // Step 1: base template, without leaving the dashboard.
  await page.locator('[data-action="onboarding-initialize-template"]').click();
  await expect(page.getByTestId('onboarding-step-done')).toHaveCount(1);

  // Step 2: financial cycle — change it away from the calendar-month default.
  await page
    .getByTestId('onboarding-step')
    .filter({ hasText: 'Финансовый цикл' })
    .getByRole('link', { name: 'Перейти' })
    .click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await page.getByLabel('Начало первого периода').fill('10');
  await page.getByLabel('Граница второго периода (дней от начала первого)').fill('15');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Финансовый цикл сохранён.')).toBeVisible();

  await page.goto('/app');
  await expect(page.getByTestId('onboarding-step-done')).toHaveCount(2);

  // Step 3: accounts.
  await createAccount(page, 'Основная карта', '10 000,00');
  await page.goto('/app');
  await expect(page.getByTestId('onboarding-step-done')).toHaveCount(3);

  // Step 4: envelope starting balances.
  await createEnvelope(page, 'Продукты', '1 000,00');
  await page.goto('/app');
  await expect(page.getByTestId('onboarding-step-done')).toHaveCount(4);

  // Step 5: first income, allocated.
  await configureIncomeAllocationRule(page);
  await createIncome(page, '12 000,00');
  await openFirstOperation(page);
  await page.getByRole('button', { name: 'Применить предложение' }).click();
  await expect(page.getByRole('button', { name: 'Применить предложение' })).toBeHidden();

  await page.goto('/app');
  await expect(page.getByTestId('dashboard-loading')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Можно потратить' })).toBeVisible();
  await expect(page.getByTestId('onboarding-checklist')).toHaveCount(0);
});

async function registerAndReachApp(page: Page): Promise<void> {
  const email = `onboarding-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function createAccount(page: Page, name: string, balance: string): Promise<void> {
  await page.goto('/app/accounts');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill(name);
  await page.getByLabel('Начальный баланс').fill(balance);
  await page.getByLabel('Дата начала учёта').pressSequentially('04092026');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(page.getByText(name)).toBeVisible();
}

async function createEnvelope(page: Page, name: string, balance: string): Promise<void> {
  await page.goto('/app/envelopes');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Создать конверт' }).first().click();
  await page.getByLabel('Название конверта').fill(name);
  await page.getByLabel('Начальный баланс').fill(balance);
  await page.getByRole('button', { name: 'Сохранить конверт' }).click();
  await expect(page.getByText(name)).toBeVisible();
}

async function configureIncomeAllocationRule(page: Page): Promise<void> {
  await page.evaluate(async (api: string) => {
    const me = (await fetch(`${api}/me`, { credentials: 'include' }).then((response) =>
      response.json(),
    )) as { workspaces: Array<{ budgets: Array<{ id: string }> }> };
    const budgetId = me.workspaces[0]?.budgets[0]?.id;
    if (!budgetId) throw new Error('Missing budget id');

    const categories = (await fetch(`${api}/budgets/${budgetId}/categories?type=INCOME`, {
      credentials: 'include',
    }).then((response) => response.json())) as Array<{ id: string; name: string }>;
    const envelopes = (await fetch(`${api}/budgets/${budgetId}/envelopes`, {
      credentials: 'include',
    }).then((response) => response.json())) as Array<{ id: string; name: string }>;
    const category = categories.find((item) => item.name === 'Премия');
    const envelope = envelopes.find((item) => item.name === 'Свободные');
    if (!category || !envelope) throw new Error('Missing template category or envelope');

    const csrf = (await fetch(`${api}/auth/csrf`, { credentials: 'include' }).then((response) =>
      response.json(),
    )) as { csrfToken: string };
    await fetch(`${api}/budgets/${budgetId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrfToken },
      body: JSON.stringify({
        incomeAllocationRuleEnabled: true,
        incomeAllocationSourceCategoryId: category.id,
        incomeAllocationTargetEnvelopeId: envelope.id,
      }),
    });
  }, apiV1);
}

async function fillOperationDate(page: Page): Promise<void> {
  const now = new Date();
  const digits = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;
  await page.getByLabel('Дата').pressSequentially(digits);
}

async function selectPill(page: Page, group: string, option: string): Promise<void> {
  await page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option }).click();
}

async function createIncome(page: Page, amount: string): Promise<void> {
  await page.goto('/app/operations');
  await page.locator('[data-action="create-operation"]').click();
  await page.getByTestId('operation-type-income').click();
  await fillOperationDate(page);
  await page.getByLabel('Сумма').fill(amount);
  await selectPill(page, 'Счёт', 'Основная карта');
  await selectPill(page, 'Категория', 'Премия');
  await page.getByTestId('entry-submit').click();
  await expect(page.getByTestId('toast-stack')).toContainText('Операция сохранена');
}

async function openFirstOperation(page: Page): Promise<void> {
  await page.getByTestId('list-row-select').first().click();
  await expect(page.getByTestId('drawer')).toBeVisible();
}
