import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

test('creates an account from the list and archives it behind the chip', async ({ page }) => {
  await registerAndReachApp(page, 'reference-accounts');
  await initializeTemplate(page);

  await page.goto('/app/accounts');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.locator('[data-action="create-account"]').click();
  await page.getByLabel('Название счёта').fill('Карта списка');
  await page.getByLabel('Начальный баланс').fill('10 000,00');
  await page.getByLabel('Дата начала учёта').fill('2026-09-04');
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

  test('keeps both lists free of horizontal overflow', async ({ page }) => {
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
  await page.getByLabel('Дата начала учёта').fill('2026-09-04');
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

// Same as the confirmed expense helpers elsewhere, but it stops at the draft so
// the row menu still offers "Подтвердить".
async function createDraftExpense(
  page: Page,
  account: string,
  envelope: string,
  merchant: string,
  amount: string,
): Promise<void> {
  await page.goto('/app/operations');
  await page.locator('[data-action="create-operation"]').click();
  // Step 1
  const today = new Date().toISOString().split('T')[0];
  await page.getByLabel('Дата операции').fill(today);
  await page.getByLabel('Сумма').fill(amount);
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 2
  await page.getByLabel('Счёт').selectOption({ label: account });
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 3
  await page.getByLabel('Категория').selectOption({ label: 'Продукты' });
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 4
  await page.getByLabel('Конверт').selectOption({ label: envelope });
  await page.getByLabel('Получатель или магазин').fill(merchant);
  await page.getByRole('button', { name: 'Создать черновик' }).click();
  await expect(page.getByText('Черновик', { exact: true })).toBeVisible();
}
