import { expect, test, type Page } from '@playwright/test';

import { apiV1 } from './env';

const password = 'e2e-password-10';

test('explains where the envelope balance comes from and lists reallocation movements', async ({
  page,
}) => {
  await registerAndSeedBreakdown(page);

  await page.goto('/app/envelopes');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();

  await page
    .getByTestId('list-row-select')
    .filter({ hasText: 'Ремонт breakdown' })
    .click();

  await expect(page.getByTestId('envelope-drawer-breakdown')).toBeVisible();
  await expect(page.getByTestId('envelope-drawer-breakdown')).toContainText('Откуда остаток');
  await expect(page.getByTestId('envelope-drawer-breakdown')).toContainText('Текущий остаток');

  const reallocations = page.getByTestId('envelope-drawer-reallocations');
  await expect(reallocations).toBeVisible();
  await expect(reallocations).toContainText('из «Резерв breakdown»');
  await expect(reallocations.locator('[data-testid="reallocation-amount"]')).toContainText('500');
});

async function registerAndSeedBreakdown(page: Page) {
  const email = `balance-breakdown-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.evaluate(
    async ({ api }) => {
      const me = (await fetch(`${api}/me`, { credentials: 'include' }).then((response) =>
        response.json(),
      )) as { workspaces: Array<{ budgets: Array<{ id: string }> }> };
      const budgetId = me.workspaces[0]?.budgets[0]?.id ?? '';

      const csrf = (
        await fetch(`${api}/auth/csrf`, { credentials: 'include' }).then((response) =>
          response.json(),
        )
      ) as { csrfToken: string };

      const mutationHeaders = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf.csrfToken,
      };

      const reserve = await fetch(`${api}/budgets/${budgetId}/envelopes`, {
        method: 'POST',
        credentials: 'include',
        headers: mutationHeaders,
        body: JSON.stringify({
          name: 'Резерв breakdown',
          envelopeType: 'RESERVE',
          currency: 'RUB',
          startingBalance: '500.00',
          displayOrder: 0,
        }),
      }).then((response) => response.json() as { id: string });

      const target = await fetch(`${api}/budgets/${budgetId}/envelopes`, {
        method: 'POST',
        credentials: 'include',
        headers: mutationHeaders,
        body: JSON.stringify({
          name: 'Ремонт breakdown',
          envelopeType: 'SAVINGS_GOAL',
          currency: 'RUB',
          startingBalance: '100.00',
          displayOrder: 1,
        }),
      }).then((response) => response.json() as { id: string });

      await fetch(`${api}/budgets/${budgetId}/envelope-reallocations`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...mutationHeaders, 'Idempotency-Key': `e2e-breakdown-${Date.now()}` },
        body: JSON.stringify({
          sourceEnvelopeId: reserve.id,
          destinationEnvelopeId: target.id,
          amount: '500.00',
          occurredOn: new Date().toISOString().slice(0, 10),
        }),
      });
    },
    { api: apiV1 },
  );
}
