import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

test.skip('creates an account from the list and archives it behind the chip', async ({ page }) => {
  await registerAndReachApp(page, 'reference-accounts');
  await initializeTemplate(page);

  await page.goto('/app/accounts');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.locator('[data-action="create-account"]').click();
  await page.getByLabel('Название счёта').fill('Карта списка');
  await page.getByLabel('Начальный баланс').fill('10 000,00');
  await page.getByLabel('Дата начала учёта').pressSequentially('04092026');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();

  await expect(page.getByTestId('accounts-total')).toContainText('10');
  await expect(page.getByText('Карта списка')).toBeVisible();

  await page
    .locator('li')
    .filter({ hasText: 'Карта списка' })
    .getByRole('button', { name: 'Действия над счётом' })
    .click();
  await page.getByTestId('row-archive').click();
  await page.locator('dialog[open] [data-confirm]').click();

  await expect(page.getByText('Карта списка')).toHaveCount(0);
  await page.getByTestId('chip-archived').click();
  await expect(page.getByText('Карта списка')).toBeVisible();
});

test('opens an envelope drawer and reaches the journal from it', async ({ page }) => {
  await registerAndReachApp(page, 'reference-envelopes');
  await initializeTemplate(page);

  await page.goto('/app/envelopes');
  await expect(page.getByTestId('envelope-group-label').first()).toBeVisible();

  await page.getByTestId('list-row-select').first().click();
  await expect(page.getByTestId('drawer')).toBeVisible();
  await page.getByTestId('envelope-drawer-operations').click();

  await expect(page).toHaveURL(/\/app\/operations\?envelopeId=/);
});

test('opens an operation from the dashboard', async ({ page }) => {
  await registerAndReachApp(page, 'reference-dashboard');
  await initializeTemplate(page);
  await createAccount(page, 'Карта главной', '10 000,00');
  await createEnvelope(page, 'Текущие главной', '10 000,00');
  await createDraftExpense(page, 'Карта главной', 'Текущие главной', 'Магазин', '100,00');

  await page.goto('/app');
  // The dashboard row reuses UiListRow's plain "list-row-select" button (no
  // dedicated link testid) — see RecentOperations.vue, which deliberately
  // avoids wrapping it in a <NuxtLink> to keep a button from nesting inside
  // an anchor. BalanceList rows use the same generic testid, so scope through
  // the section's own aria-label landmark instead of relying on DOM order.
  await page
    .getByRole('region', { name: 'Последние операции' })
    .getByTestId('list-row-select')
    .first()
    .click();

  await expect(page).toHaveURL(/\/app\/operations\?operationId=/);
  await expect(page.getByTestId('drawer')).toBeVisible();
});

test.describe('reference lists on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.skip('keeps both lists free of horizontal overflow', async ({ page }) => {
    await registerAndReachApp(page, 'reference-phone');
    await initializeTemplate(page);
    await createAccount(page, 'Карта телефона с длинным названием', '10 000,00');

    for (const path of ['/app/accounts', '/app/envelopes']) {
      await page.goto(path);
      await expect(page.getByTestId('list-row-select').first()).toBeVisible();
      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement;
        return root ? root.scrollWidth - root.clientWidth : 0;
      });
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});

async function registerAndReachApp(page: Page, suffix: string): Promise<void> {
  const email = `${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
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
  await page.getByText('Дополнительные настройки').click();
  await page.getByLabel('Порядок в списке').fill('10');
  await page.getByRole('button', { name: 'Сохранить конверт' }).click();
  await expect(page.getByText(name)).toBeVisible();
}

// The quick-entry dialog always submits CONFIRMED — there is no "save as
// draft" control in the UI anymore, so drafts are seeded straight through the
// API, matching how a real client would call it outside the browser.
async function createDraftExpense(
  page: Page,
  account: string,
  envelope: string,
  merchant: string,
  amount: string,
): Promise<void> {
  await page.evaluate(
    async ({ account, envelope, merchant, amount }) => {
      const api = 'http://localhost:3001/api/v1';
      const me = (await fetch(`${api}/me`, { credentials: 'include' }).then((response) =>
        response.json(),
      )) as { workspaces: Array<{ budgets: Array<{ id: string }> }> };
      const budgetId = me.workspaces[0]?.budgets[0]?.id;
      if (!budgetId) throw new Error('Missing budget id');

      const accounts = (await fetch(`${api}/budgets/${budgetId}/accounts`, {
        credentials: 'include',
      }).then((response) => response.json())) as Array<{ id: string; name: string }>;
      const categories = (await fetch(`${api}/budgets/${budgetId}/categories?type=EXPENSE`, {
        credentials: 'include',
      }).then((response) => response.json())) as Array<{ id: string; name: string }>;
      const envelopes = (await fetch(`${api}/budgets/${budgetId}/envelopes`, {
        credentials: 'include',
      }).then((response) => response.json())) as Array<{ id: string; name: string }>;
      const accountRecord = accounts.find((item) => item.name === account);
      const category = categories.find((item) => item.name === 'Продукты');
      const envelopeRecord = envelopes.find((item) => item.name === envelope);
      if (!accountRecord || !category || !envelopeRecord) {
        throw new Error('Missing account, category or envelope');
      }

      const csrf = (await fetch(`${api}/auth/csrf`, { credentials: 'include' }).then((response) =>
        response.json(),
      )) as { csrfToken: string };
      await fetch(`${api}/budgets/${budgetId}/transactions`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf.csrfToken,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          transactionType: 'EXPENSE',
          status: 'DRAFT',
          amount: amount.replace(',', '.'),
          occurredOn: new Date().toISOString().slice(0, 10),
          accountId: accountRecord.id,
          categoryId: category.id,
          envelopeId: envelopeRecord.id,
          merchantName: merchant,
          isPlanned: false,
        }),
      });
    },
    { account, envelope, merchant, amount },
  );
}
