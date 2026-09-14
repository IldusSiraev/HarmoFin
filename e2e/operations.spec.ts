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
  await expect(page.getByRole('button', { name: 'Применить предложение' })).toBeVisible();
  await page.getByRole('button', { name: 'Применить предложение' }).click();
  await expect(page.getByText(/доступно 0 минимальных единиц/)).toBeVisible();

  await page.goto('/app/accounts');
  await expect(page.getByText(/22.*000.*00/).first()).toBeVisible();

  await page.goto('/app/operations');
  await page.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await page.getByRole('button', { name: 'Фильтры' }).click();
  await page.getByLabel('Статус').selectOption('DELETED');
  await expect(page.getByText('Удалена', { exact: true })).toBeVisible();
});

test('owner changes and rejects non-binding generic allocation proposals', async ({ page }) => {
  await registerAndReachApp(page);
  await initializeTemplate(page);
  await createAccount(page, 'Основная карта', '10 000,00');
  await configureIncomeAllocationRule(page);

  await createIncome(page, '12 000,00', 'CONFIRMED');
  await page.getByLabel('Распределение дохода').getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Сумма распределения').fill('1 000,00');
  await page.getByRole('button', { name: 'Сохранить распределение' }).click();
  await expect(page.getByText(/доступно 1100000 минимальных единиц/)).toBeVisible();

  await createIncome(page, '2 000,00', 'CONFIRMED');
  await page.getByRole('button', { name: 'Не распределять' }).last().click();
  await expect(page.getByText('Предложение распределения отклонено.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Не распределять' })).toHaveCount(1);
});

test('browser retry with same idempotency key creates one income', async ({ page }) => {
  await registerAndReachApp(page);
  await initializeTemplate(page);
  await createAccount(page, 'Основная карта', '10 000,00');

  await page.goto('/app/operations');
  await page.getByRole('button', { name: 'Добавить операцию' }).click();
  await page.getByLabel('Тип операции').selectOption('INCOME');
  await page.getByLabel(/^Счёт\s*\*?$/).selectOption({ label: 'Основная карта' });
  await page.getByLabel(/^Категория\s*\*?$/).selectOption({ label: 'Шабашка' });
  await page.getByLabel('Сумма').fill('10,00');
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
  await page.getByRole('button', { name: 'Добавить операцию' }).click();
  await page.getByLabel(/^Счёт\s*\*?$/).selectOption({ label: 'Основная карта' });
  await page.getByLabel(/^Категория\s*\*?$/).selectOption({ label: 'Продукты' });
  await page.getByLabel(/^Конверт\s*\*?$/).selectOption({ label: 'Продукты на неделю' });
  await page.getByLabel('Сумма').fill('1.234');
  await page.getByRole('button', { name: 'Создать черновик' }).click();
  await expect(page.getByLabel('Сумма')).toHaveAttribute('aria-invalid', 'true');

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
  await expect(page.getByText('Подтверждена', { exact: true })).toHaveCount(1);

  await createIncome(page, '10,00', 'DRAFT');
  const cancelOperation = page.getByRole('button', { name: 'Отменить' });
  await cancelOperation.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(cancelOperation).toBeFocused();
  await cancelOperation.click();
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByText('Отменена')).toBeVisible();
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
    // On a phone the bottom navigation carries the same accessible name, so
    // this has to name the journal's own button.
    await page.getByRole('main').getByRole('button', { name: 'Добавить операцию' }).click();
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
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill(name);
  await page.getByLabel('Начальный баланс').fill(balance);
  await page.getByLabel('Дата начала учёта').fill('2026-09-04');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(page.getByText(name)).toBeVisible();
}

async function createEnvelope(page: Page, name: string, balance: string): Promise<void> {
  await page.goto('/app/envelopes');
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

async function createIncome(
  page: Page,
  amount: string,
  status: 'DRAFT' | 'CONFIRMED',
): Promise<void> {
  await page.goto('/app/operations');
  await page.getByRole('button', { name: 'Добавить операцию' }).click();
  await page.getByLabel('Тип операции').selectOption('INCOME');
  await page.getByLabel(/^Счёт\s*\*?$/).selectOption({ label: 'Основная карта' });
  await page.getByLabel(/^Категория\s*\*?$/).selectOption({ label: 'Шабашка' });
  await page.getByLabel('Сумма').fill(amount);
  await page
    .getByRole('button', { name: status === 'DRAFT' ? 'Создать черновик' : 'Подтвердить операцию' })
    .click();
  if (status === 'CONFIRMED') {
    await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await expect(page.getByText('Подтверждена', { exact: true })).toBeVisible();
  } else {
    await expect(page.getByText('Черновик', { exact: true })).toBeVisible();
  }
}

async function createExpense(
  page: Page,
  amount: string,
  status: 'DRAFT' | 'CONFIRMED',
): Promise<void> {
  await page.getByRole('button', { name: 'Добавить операцию' }).click();
  await page.getByLabel(/^Счёт\s*\*?$/).selectOption({ label: 'Основная карта' });
  await page.getByLabel(/^Категория\s*\*?$/).selectOption({ label: 'Продукты' });
  await page.getByLabel(/^Конверт\s*\*?$/).selectOption({ label: 'Продукты на неделю' });
  await page.getByLabel('Сумма').fill(amount);
  await page
    .getByRole('button', { name: status === 'DRAFT' ? 'Создать черновик' : 'Подтвердить операцию' })
    .click();
  if (status === 'CONFIRMED') {
    await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  }
}
