import { expect, test, type Page } from '@playwright/test';
import { apiV1 } from './env';

const password = 'e2e-password-10';

test('prompts to move a previous period leftover and lets the owner move it entirely', async ({
  page,
}) => {
  const { budgetId, csrfToken, previousEnvelopeId, currentEnvelopeName } =
    await registerAndSeedLeftover(page, 'move-all');

  await page.goto('/app');
  await expect(page.getByTestId('period-leftover-prompt')).toBeVisible();
  await expect(page.getByTestId('period-leftover-prompt')).toContainText('5 000,00');
  await expect(page.getByTestId('period-leftover-prompt')).toContainText(currentEnvelopeName);

  await page.getByRole('button', { name: 'Перенести остаток' }).click();
  await expect(page.getByTestId('period-leftover-prompt')).toBeHidden();

  const balance = await page.evaluate(
    async ({ api, budgetId, envelopeId }) => {
      const response = await fetch(`${api}/budgets/${budgetId}/envelopes/${envelopeId}`, {
        credentials: 'include',
      });
      return (await response.json()) as { currentBalanceMinor: string };
    },
    { api: apiV1, budgetId, envelopeId: previousEnvelopeId },
  );
  expect(balance.currentBalanceMinor).toBe('0');
  void csrfToken;
});

test('lets the owner distribute part of a previous period leftover into a chosen envelope', async ({
  page,
}) => {
  await registerAndSeedLeftover(page, 'distribute');

  await page.goto('/app/envelopes');
  await waitForHydration(page);
  await page.getByRole('button', { name: 'Создать конверт' }).first().click();
  await page.getByLabel('Название конверта').fill('Отпуск distribute');
  await page.getByLabel('Начальный баланс').fill('0,00');
  await page.getByRole('button', { name: 'Сохранить конверт' }).click();
  await expect(page.getByText('Отпуск distribute')).toBeVisible();

  await page.goto('/app');
  await expect(page.getByTestId('period-leftover-prompt')).toBeVisible();
  await page.getByRole('button', { name: 'Распределить в другой конверт' }).click();
  await page.getByLabel('Конверт назначения').selectOption({ label: 'Отпуск distribute' });
  await page.getByLabel('Сумма').fill('20,00');
  await page.getByRole('button', { name: 'Распределить', exact: true }).click();

  await expect(page.getByTestId('period-leftover-prompt')).toContainText('4 980,00');
});

async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
}

async function registerAndSeedLeftover(page: Page, suffix: string) {
  const email = `period-leftover-${suffix}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);

  const session = await page.evaluate(
    async ({ api }) => {
      const csrf = (await fetch(`${api}/auth/csrf`, { credentials: 'include' }).then((response) =>
        response.json(),
      )) as { csrfToken: string };
      return csrf;
    },
    { api: apiV1 },
  );

  const me = await page.evaluate(
    async ({ api }) => {
      const response = await fetch(`${api}/me`, { credentials: 'include' });
      return (await response.json()) as {
        workspaces: Array<{ budgets: Array<{ id: string }> }>;
      };
    },
    { api: apiV1 },
  );
  const budgetId = me.workspaces[0]?.budgets[0]?.id ?? '';

  // Today's period under the default cycle (start day 1, boundary offset 15):
  // days 1-14 are FIRST, days 15-end are SECOND. The "other" slot is always
  // the previous period once a boundary has been crossed.
  const dayOfMonth = new Date().getUTCDate();
  const currentSlot = dayOfMonth < 15 ? 'FIRST' : 'SECOND';
  const previousSlot = currentSlot === 'FIRST' ? 'SECOND' : 'FIRST';
  const currentEnvelopeName = `Текущие ${suffix} ${currentSlot}`;
  const previousEnvelopeName = `Текущие ${suffix} ${previousSlot}`;

  const currentEnvelopeId = await createPeriodEnvelope(
    page,
    session.csrfToken,
    budgetId,
    currentEnvelopeName,
    currentSlot,
    '0.00',
  );
  const previousEnvelopeId = await createPeriodEnvelope(
    page,
    session.csrfToken,
    budgetId,
    previousEnvelopeName,
    previousSlot,
    '5000.00',
  );

  return {
    budgetId,
    csrfToken: session.csrfToken,
    currentEnvelopeId,
    previousEnvelopeId,
    currentEnvelopeName,
  };
}

async function createPeriodEnvelope(
  page: Page,
  csrfToken: string,
  budgetId: string,
  name: string,
  periodSlot: 'FIRST' | 'SECOND',
  startingBalance: string,
): Promise<string> {
  const created = await page.evaluate(
    async ({ api, csrfToken, budgetId, name, periodSlot, startingBalance }) => {
      const response = await fetch(`${api}/budgets/${budgetId}/envelopes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({
          name,
          envelopeType: 'CURRENT_EXPENSES',
          periodSlot,
          currency: 'RUB',
          startingBalance,
          displayOrder: periodSlot === 'FIRST' ? 0 : 1,
        }),
      });
      return (await response.json()) as { id: string };
    },
    { api: apiV1, csrfToken, budgetId, name, periodSlot, startingBalance },
  );
  return created.id;
}
