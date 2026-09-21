import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

test('owner accepts generic income allocation and logically deletes confirmed income', async ({
  page,
}) => {
  await registerAndReachApp(page);
  await initializeTemplate(page);
  await createAccount(page, 'Основная карта', '10 000,00');
  await configureIncomeAllocationRule(page);

  await createIncome(page, '12 000,00');
  await openFirstOperation(page);
  await expect(page.getByRole('button', { name: 'Применить предложение' })).toBeVisible();
  await page.getByRole('button', { name: 'Применить предложение' }).click();
  await expect(page.getByRole('button', { name: 'Применить предложение' })).toBeHidden();

  await page.goto('/app/accounts');
  await expect(page.getByText(/22.*000.*00/).first()).toBeVisible();

  await page.goto('/app/operations');
  await openFirstOperation(page);
  await page.getByTestId('drawer-delete').click();
  await confirmDialog(page);
  // Deleting an income with confirmed allocations asks for a second decision.
  await page.locator('dialog[open]').getByRole('button', { name: 'Удалить распределения' }).click();
  await expect(page.getByTestId('toast-stack')).toContainText('Операция удалена');

  await filterByStatus(page, 'DELETED');
  await expect(page.getByText('Удалена', { exact: true })).toBeVisible();
});

test('owner changes and rejects non-binding generic allocation proposals', async ({ page }) => {
  await registerAndReachApp(page);
  await initializeTemplate(page);
  await createAccount(page, 'Основная карта', '10 000,00');
  await configureIncomeAllocationRule(page);

  await createIncome(page, '12 000,00', 'Доход первый');
  await openFirstOperation(page, 'Доход первый');
  await page.getByLabel('Распределение дохода').getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Сумма распределения').fill('1 000,00');
  await page.getByRole('button', { name: 'Сохранить распределение' }).click();
  await expect(page.getByText(/доступно 11.*000.*00/)).toBeVisible();
  await page.getByTestId('drawer-close').click();

  await createIncome(page, '2 000,00', 'Доход второй');
  await openFirstOperation(page, 'Доход второй');
  await page.getByRole('button', { name: 'Не распределять' }).click();
  await expect(page.getByRole('button', { name: 'Не распределять' })).toHaveCount(0);
  await expect(page.getByText('Распределений пока нет.')).toBeVisible();
});

test('browser retry with same idempotency key creates one income', async ({ page }) => {
  await registerAndReachApp(page);
  await initializeTemplate(page);
  await createAccount(page, 'Основная карта', '10 000,00');

  await page.goto('/app/operations');
  await page.locator('[data-action="create-operation"]').click();
  await page.getByTestId('operation-type-income').click();
  await fillOperationDate(page);
  await page.getByLabel('Сумма').fill('10,00');
  await selectPill(page, 'Счёт', 'Основная карта');
  await selectPill(page, 'Категория', 'Премия');

  const requestPromise = page.waitForRequest(
    (request) => request.method() === 'POST' && /\/transactions$/.test(request.url()),
  );
  await page.getByTestId('entry-submit').click();
  const request = await requestPromise;
  await expect(page.getByTestId('toast-stack')).toContainText('Операция сохранена');

  const replay = await page.evaluate(
    async ({ url, body, idempotencyKey }) => {
      const csrf = (await fetch('http://localhost:3001/api/v1/auth/csrf', {
        credentials: 'include',
      }).then((response) => response.json())) as { csrfToken: string };
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf.csrfToken,
          'Idempotency-Key': idempotencyKey,
        },
        body,
      });
      return { status: response.status, body: await response.json() };
    },
    {
      url: request.url(),
      body: request.postData() ?? '',
      idempotencyKey: request.headers()['idempotency-key'] ?? '',
    },
  );

  expect(replay.status).toBe(201);
  await page.reload();
  await expect(page.getByTestId('list-row-select')).toHaveCount(1);
});

test('owner sees financial validation and server-confirmed expense lifecycle', async ({ page }) => {
  await registerAndReachApp(page);
  await initializeTemplate(page);
  await createAccount(page, 'Основная карта', '1 000,00');
  await createEnvelope(page, 'Продукты на неделю', '1 000,00');

  await page.goto('/app/operations');
  await page.locator('[data-action="create-operation"]').click();
  await page.getByTestId('operation-type-expense').click();
  await fillOperationDate(page);
  await page.getByLabel('Сумма').fill('1.234');
  await selectPill(page, 'Счёт', 'Основная карта');
  await selectPill(page, 'Категория', 'Продукты');
  await selectPill(page, 'Конверт', 'Продукты на неделю');
  await page.getByTestId('entry-submit').click();
  await expect(page.getByRole('alert')).toContainText(/денеж|формат|знаков|данные|заполн/i);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Новая операция' })).toBeHidden();

  await createExpense(page, '100,00');
  await page.goto('/app/accounts');
  await expect(page.getByText(/900.*00/).first()).toBeVisible();
  await page.goto('/app/envelopes');
  await expect(page.getByText(/900.*00/).first()).toBeVisible();

  await page.goto('/app/operations');
  await createExpense(page, '1 000,00');
  await expect(page.getByRole('alert')).toContainText(
    'Недостаточно средств на счёте или в конверте.',
  );
  await expect(page.getByTestId('list-row-select')).toHaveCount(1);

  await createDraftIncomeViaApi(page, '10,00', 'Премия', 'Основная карта', 'Черновик дохода');
  await page.goto('/app/operations');
  await openRowMenu(page, 'Черновик дохода');
  await page.getByTestId('row-cancel').click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  await openRowMenu(page, 'Черновик дохода');
  await page.getByTestId('row-cancel').click();
  await confirmDialog(page);
  await expect(page.getByTestId('toast-stack')).toContainText('Операция отменена');
  await expect(page.getByText('Отменена', { exact: true })).toBeVisible();
});

test.describe('operations mobile route', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('redirects protected journal and has no horizontal overflow after registration', async ({
    page,
  }) => {
    await page.goto('/app/operations');
    await expect(page).toHaveURL(/\/login$/);
    await registerAndReachApp(page);
    await page.goto('/app/operations');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Операции');
    await page.locator('[data-action="create-operation"]').click();
    await expect(page.getByRole('dialog', { name: 'Что произошло?' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
  });
});

async function registerAndReachApp(page: Page): Promise<void> {
  const email = `operations-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
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

async function configureIncomeAllocationRule(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = 'http://localhost:3001/api/v1';
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
  });
}

// The row is one button; its "⋮" menu sits outside that button.
async function openRowMenu(page: Page, text?: string): Promise<void> {
  const row =
    text === undefined ? page.locator('li') : page.locator('li').filter({ hasText: text });
  await row.first().getByTestId('action-menu-trigger').click();
}

async function openFirstOperation(page: Page, text?: string): Promise<void> {
  const row =
    text === undefined
      ? page.getByTestId('list-row-select').first()
      : page.locator('li').filter({ hasText: text }).getByTestId('list-row-select').first();
  await row.click();
  await expect(page.getByTestId('drawer')).toBeVisible();
}

async function confirmDialog(page: Page): Promise<void> {
  await page.locator('dialog[open] [data-confirm]').click();
}

async function filterByStatus(page: Page, status: string): Promise<void> {
  await page.getByTestId('more-filters').click();
  await page.getByRole('combobox', { name: 'Статус' }).selectOption(status);
  await page.getByRole('button', { name: 'Готово' }).click();
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

async function createIncome(page: Page, amount: string, source?: string): Promise<void> {
  await page.goto('/app/operations');
  await page.locator('[data-action="create-operation"]').click();
  await page.getByTestId('operation-type-income').click();
  await fillOperationDate(page);
  await page.getByLabel('Сумма').fill(amount);
  await selectPill(page, 'Счёт', 'Основная карта');
  await selectPill(page, 'Категория', 'Премия');
  if (source !== undefined) await page.getByLabel('Заметка').fill(source);
  await page.getByTestId('entry-submit').click();
  await expect(page.getByTestId('toast-stack')).toContainText('Операция сохранена');
}

async function createExpense(page: Page, amount: string): Promise<void> {
  await page.locator('[data-action="create-operation"]').click();
  await page.getByTestId('operation-type-expense').click();
  await fillOperationDate(page);
  await page.getByLabel('Сумма').fill(amount);
  await selectPill(page, 'Счёт', 'Основная карта');
  await selectPill(page, 'Категория', 'Продукты');
  await selectPill(page, 'Конверт', 'Продукты на неделю');
  await page.getByTestId('entry-submit').click();
}

// The quick-entry dialog only ever submits CONFIRMED — draft creation now
// requires going through the API directly, matching how a real client would
// call it outside the UI.
async function createDraftIncomeViaApi(
  page: Page,
  amount: string,
  categoryName: string,
  accountName: string,
  source?: string,
): Promise<void> {
  await page.evaluate(
    async ({ amount, categoryName, accountName, source }) => {
      const api = 'http://localhost:3001/api/v1';
      const me = (await fetch(`${api}/me`, { credentials: 'include' }).then((response) =>
        response.json(),
      )) as { workspaces: Array<{ budgets: Array<{ id: string }> }> };
      const budgetId = me.workspaces[0]?.budgets[0]?.id;
      if (!budgetId) throw new Error('Missing budget id');

      const accounts = (await fetch(`${api}/budgets/${budgetId}/accounts`, {
        credentials: 'include',
      }).then((response) => response.json())) as Array<{ id: string; name: string }>;
      const categories = (await fetch(`${api}/budgets/${budgetId}/categories?type=INCOME`, {
        credentials: 'include',
      }).then((response) => response.json())) as Array<{ id: string; name: string }>;
      const account = accounts.find((item) => item.name === accountName);
      const category = categories.find((item) => item.name === categoryName);
      if (!account || !category) throw new Error('Missing account or category');

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
          transactionType: 'INCOME',
          status: 'DRAFT',
          amount: amount.replace(',', '.'),
          occurredOn: new Date().toISOString().slice(0, 10),
          accountId: account.id,
          categoryId: category.id,
          sourceDescription: source,
          isPlanned: false,
        }),
      });
    },
    { amount, categoryName, accountName, source },
  );
}
