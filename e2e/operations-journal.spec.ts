import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

test('confirms a draft from the row menu', async ({ page }) => {
  await registerAndReachApp(page, 'journal-confirm');
  await initializeTemplate(page);
  await createAccount(page, 'Карта журнала', '10 000,00');
  await createEnvelope(page, 'Текущие журнала', '10 000,00');
  await createDraftExpense(page, 'Карта журнала', 'Текущие журнала', 'Магазин', '100,00');

  await page.goto('/app/operations');
  await page.getByTestId('action-menu-trigger').first().click();
  await page.getByTestId('row-confirm').click();
  await page.locator('dialog[open] [data-confirm]').click();

  await expect(page.getByTestId('toast-stack')).toContainText('Операция подтверждена');
  await expect(page.getByText('Черновик', { exact: true })).toHaveCount(0);
});

test('restores a deleted operation from the drawer', async ({ page }) => {
  await registerAndReachApp(page, 'journal-restore');
  await initializeTemplate(page);
  await createAccount(page, 'Карта восстановления', '10 000,00');
  await createEnvelope(page, 'Текущие восстановления', '10 000,00');
  await createDraftExpense(
    page,
    'Карта восстановления',
    'Текущие восстановления',
    'Магазин',
    '100,00',
  );

  await page.goto('/app/operations');
  await page.getByTestId('action-menu-trigger').first().click();
  await page.getByTestId('row-delete').click();
  await page.locator('dialog[open] [data-confirm]').click();
  await expect(page.getByTestId('toast-stack')).toContainText('Операция удалена');

  await page.getByTestId('more-filters').click();
  await page.getByRole('combobox', { name: 'Статус' }).selectOption('DELETED');
  await page.getByRole('button', { name: 'Готово' }).click();

  await page.getByTestId('list-row-select').first().click();
  await page.getByTestId('drawer-restore').click();

  await expect(page.getByTestId('toast-stack')).toContainText('Операция восстановлена');
});

test('creates an operation with the global button from another screen', async ({ page }) => {
  await registerAndReachApp(page, 'journal-global');
  await initializeTemplate(page);
  await createAccount(page, 'Карта из оболочки', '10 000,00');

  await page.goto('/app/accounts');
  // The shell renders server-side, so wait for client-rendered content before
  // driving the add menu — a pre-hydration click does nothing.
  await expect(page.getByText('Карта из оболочки')).toBeVisible();
  await page.getByTestId('add-menu-trigger').filter({ visible: true }).click();
  await page.getByTestId('operation-type-income').click();

  await fillOperationDate(page);
  await page.getByLabel('Сумма').fill('500,00');
  await selectPill(page, 'Счёт', 'Карта из оболочки');
  await selectPill(page, 'Категория', 'Премия');
  await page.getByLabel('Заметка').fill('Доход из оболочки');
  await page.getByTestId('entry-submit').click();

  await expect(page.getByTestId('toast-stack')).toContainText('Операция сохранена');

  await page.goto('/app/operations');
  await expect(page.getByText('Доход из оболочки')).toBeVisible();
});

test.describe('journal on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the journal readable without horizontal overflow', async ({ page }) => {
    await registerAndReachApp(page, 'journal-phone');
    await initializeTemplate(page);
    await createAccount(page, 'Карта телефона', '10 000,00');
    await createEnvelope(page, 'Текущие телефона', '10 000,00');
    // Long names on purpose: a row that cannot shrink used to widen the page.
    await createDraftExpense(
      page,
      'Карта телефона',
      'Текущие телефона',
      'Супермаркет у дома на углу',
      '100,00',
    );

    await page.goto('/app/operations');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Операции');
    await expect(page.getByTestId('list-row-select').first()).toBeVisible();

    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement;
      return root ? root.scrollWidth - root.clientWidth : 0;
    });
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByTestId('list-row-select').first().click();
    await expect(page.getByTestId('drawer')).toBeVisible();
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

// The quick-entry dialog date field always reads "Дата" — it presets the
// current date, but only typing overwrites the stale mask placeholder.
async function fillOperationDate(page: Page): Promise<void> {
  const now = new Date();
  const digits = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;
  await page.getByLabel('Дата').pressSequentially(digits);
}

// UiPillSelect renders each field as a radiogroup of buttons, not a <select>.
async function selectPill(page: Page, group: string, option: string): Promise<void> {
  await page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option }).click();
}
