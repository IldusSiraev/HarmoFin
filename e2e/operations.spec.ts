import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

test('owner accepts generic income allocation and logically deletes confirmed income', async ({
  page,
}) => {
  await registerAndReachApp(page);
  await initializeTemplate(page);
  await createAccount(page, 'Основная карта', '10 000,00');
  await configureIncomeAllocationRule(page);

  await createIncome(page, '12 000,00', 'CONFIRMED');
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

  await createIncome(page, '12 000,00', 'CONFIRMED', 'Доход первый');
  await openFirstOperation(page, 'Доход первый');
  await page.getByLabel('Распределение дохода').getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Сумма распределения').fill('1 000,00');
  await page.getByRole('button', { name: 'Сохранить распределение' }).click();
  await expect(page.getByText(/доступно 11.*000.*00/)).toBeVisible();
  await page.getByTestId('drawer-close').click();

  await createIncome(page, '2 000,00', 'CONFIRMED', 'Доход второй');
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
  // Step 1
  await page.getByLabel('Тип операции').selectOption('INCOME');
  const today = new Date().toISOString().split('T')[0];
  await page.getByLabel('Дата операции').fill(today);
  await page.getByLabel('Сумма').fill('10,00');
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 2
  await page.getByLabel(/^Счёт\s*\*?$/).selectOption({ label: 'Основная карта' });
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 3
  await page.getByLabel(/^Категория\s*\*?$/).selectOption({ label: 'Шабашка' });
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 4
  const requestPromise = page.waitForRequest(
    (request) => request.method() === 'POST' && /\/transactions$/.test(request.url()),
  );
  await page.getByRole('button', { name: 'Создать черновик' }).click();
  const request = await requestPromise;
  await expect(page.getByText('Черновик', { exact: true })).toHaveCount(1);

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
  await expect(page.getByText('Черновик', { exact: true })).toHaveCount(1);
});

test('owner sees financial validation and server-confirmed expense lifecycle', async ({ page }) => {
  await registerAndReachApp(page);
  await initializeTemplate(page);
  await createAccount(page, 'Основная карта', '1 000,00');
  await createEnvelope(page, 'Продукты на неделю', '1 000,00');

  await page.goto('/app/operations');
  await page.locator('[data-action="create-operation"]').click();
  // Step 1
  const today = new Date().toISOString().split('T')[0];
  await page.getByLabel('Дата операции').fill(today);
  await page.getByLabel('Сумма').fill('1.234');
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 2
  await page.getByLabel(/^Счёт\s*\*?$/).selectOption({ label: 'Основная карта' });
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 3
  await page.getByLabel('Категория').selectOption({ label: 'Продукты' });
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 4
  await page.getByLabel(/^Конверт\s*\*?$/).selectOption({ label: 'Продукты на неделю' });
  await page.getByRole('button', { name: 'Создать черновик' }).click();
  await expect(page.getByRole('alert')).toContainText(/денеж|формат|знаков|данные|заполн/i);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await createExpense(page, '100,00', 'CONFIRMED');
  await page.goto('/app/accounts');
  await expect(page.getByText(/900.*00/).first()).toBeVisible();
  await page.goto('/app/envelopes');
  await expect(page.getByText(/900.*00/).first()).toBeVisible();

  await page.goto('/app/operations');
  await createExpense(page, '1 000,00', 'CONFIRMED');
  await expect(page.getByRole('alert')).toContainText(
    'Недостаточно средств на счёте или в конверте.',
  );
  await expect(page.getByTestId('list-row-select')).toHaveCount(1);

  await createIncome(page, '10,00', 'DRAFT', 'Черновик дохода');
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
    await expect(page.getByLabel('Тип операции')).toBeVisible();
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

async function configureIncomeAllocationRule(page: Page): Promise<void> {
  await page.goto('/app/settings');
  await page.getByLabel('Настроить автоматическое распределение дохода').check();
  await page.getByLabel('Категория дохода').selectOption({ label: 'Шабашка' });
  await page.getByLabel(/^Конверт\s*\*?$/).selectOption({ label: 'Свободные' });
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(page.getByText('Настройки бюджета сохранены.')).toBeVisible();
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

async function createIncome(
  page: Page,
  amount: string,
  status: 'DRAFT' | 'CONFIRMED',
  source?: string,
): Promise<void> {
  await page.goto('/app/operations');
  await page.locator('[data-action="create-operation"]').click();
  // Step 1: operation type, date, amount
  await page.getByLabel('Тип операции').selectOption('INCOME');
  const today = new Date().toISOString().split('T')[0];
  await page.getByLabel('Дата операции').fill(today);
  await page.getByLabel('Сумма').fill(amount);
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 2: account
  await page.getByLabel('Счёт').selectOption({ label: 'Основная карта' });
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 3: category
  await page.getByLabel('Категория').selectOption({ label: 'Шабашка' });
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 4: details
  if (source !== undefined) await page.getByLabel('Источник дохода').fill(source);
  await page
    .getByRole('button', { name: status === 'DRAFT' ? 'Создать черновик' : 'Подтвердить операцию' })
    .click();
  if (status === 'CONFIRMED') {
    await confirmDialog(page);
    await expect(page.getByTestId('toast-stack')).toContainText('Операция подтверждена');
  } else {
    await expect(page.getByText('Черновик', { exact: true })).toBeVisible();
  }
}

async function createExpense(
  page: Page,
  amount: string,
  status: 'DRAFT' | 'CONFIRMED',
): Promise<void> {
  await page.locator('[data-action="create-operation"]').click();
  // Step 1: operation type, date, amount
  const today = new Date().toISOString().split('T')[0];
  await page.getByLabel('Дата операции').fill(today);
  await page.getByLabel('Сумма').fill(amount);
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 2: account
  await page.getByLabel('Счёт').selectOption({ label: 'Основная карта' });
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 3: category
  await page.getByLabel('Категория').selectOption({ label: 'Продукты' });
  await page.getByRole('button', { name: 'Далее' }).click();
  // Step 4: envelope and merchant
  await page.getByLabel('Конверт').selectOption({ label: 'Продукты на неделю' });
  await page
    .getByRole('button', { name: status === 'DRAFT' ? 'Создать черновик' : 'Подтвердить операцию' })
    .click();
  if (status === 'CONFIRMED') {
    await confirmDialog(page);
  }
}
