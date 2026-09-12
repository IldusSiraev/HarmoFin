import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

test('owner edits, resolves allocation deletion, restores operation, and sees audit history', async ({
  page,
}) => {
  await registerAndReachApp(page, 'lifecycle');
  await initializeTemplate(page);
  await createAccount(page, 'Основная Stage 3b', '10 000,00');
  await configureIncomeAllocationRule(page);
  await createIncome(page, 'Премия до редактирования', '1 000,00');

  await page.getByRole('button', { name: 'Применить предложение' }).click();
  await expect(page.getByText(/доступно 0 минимальных единиц/)).toBeVisible();

  await page.getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Источник дохода').fill('Премия после редактирования');
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByText('Премия после редактирования')).toBeVisible();

  await page.getByRole('button', { name: 'Детали' }).click();
  await expect(page.getByRole('heading', { name: 'Распределения дохода' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'История изменений' })).toBeVisible();

  const deleteButton = page.getByRole('button', { name: 'Удалить' });
  await deleteButton.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(deleteButton).toBeFocused();

  await deleteButton.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByText('Данные обновлены на сервере.')).toBeVisible();

  await page.getByLabel('Статус').selectOption('DELETED');
  await expect(page.getByText('Удалена', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Восстановить' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await page.getByLabel('Статус').selectOption('');
  await expect(page.getByText('Подтверждена', { exact: true })).toBeVisible();
});

test('journal filters, sort, reset, direct links, and dashboard use server data', async ({
  page,
}) => {
  await registerAndReachApp(page, 'journal');
  await initializeTemplate(page);
  await createAccount(page, 'Карта Stage 3b', '10 000,00');
  await createEnvelope(page, 'Продукты Stage 3b', '10 000,00');
  await createExpense(
    page,
    'Карта Stage 3b',
    'Продукты Stage 3b',
    'Супермаркет Stage 3b',
    '100,00',
  );

  await page.goto('/app');
  await expect(page.getByText('Всего на счетах')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Счета' })).toBeVisible();
  await expect(page.getByText('Карта Stage 3b')).toBeVisible();

  await page.goto('/app/accounts');
  await page
    .getByRole('article')
    .filter({ hasText: 'Карта Stage 3b' })
    .getByRole('link', { name: 'Операции счёта' })
    .click();
  await expect(page).toHaveURL(/\/app\/operations\?accountId=/);
  await expect(page.getByLabel('Счёт в журнале')).toHaveValue(/.+/);

  await page.goto('/app/envelopes');
  await page
    .getByRole('article')
    .filter({ hasText: 'Продукты Stage 3b' })
    .getByRole('link', { name: 'Операции конверта' })
    .click();
  await expect(page).toHaveURL(/\/app\/operations\?envelopeId=/);
  await expect(page.getByLabel('Конверт в журнале')).toHaveValue(/.+/);

  await page.getByLabel('Поиск').fill('Супермаркет Stage 3b');
  await expect(page.getByText('Супермаркет Stage 3b')).toBeVisible();
  await expect(page).toHaveURL(
    /search=%D0%A1%D1%83%D0%BF%D0%B5%D1%80%D0%BC%D0%B0%D1%80%D0%BA%D0%B5%D1%82/,
  );
  await page.getByRole('button', { name: 'Сортировать по сумме' }).click();
  await expect(page).toHaveURL(/sortBy=amount/);
  await page.getByRole('button', { name: 'Сортировать по сумме' }).click();
  await expect(page).toHaveURL(/sortBy=amount.*sortDirection=asc/);
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await expect(page).toHaveURL(/\/app\/operations$/);
});

test('analytics row opens server-filtered journal', async ({ page }) => {
  await registerAndReachApp(page, 'analytics');
  await initializeTemplate(page);
  await createAccount(page, 'Счёт аналитики', '10 000,00');
  await createEnvelope(page, 'Конверт аналитики', '10 000,00');
  await createExpense(
    page,
    'Счёт аналитики',
    'Конверт аналитики',
    'Аналитический магазин',
    '200,00',
  );

  await page.goto('/app/analytics');
  await expect(page.getByRole('heading', { name: 'Отчёты бюджета' })).toBeVisible();
  const journalLink = page.getByRole('link', { name: 'Открыть' });
  await expect(journalLink).toBeVisible();
  await journalLink.click();
  await expect(page).toHaveURL(
    /\/app\/operations\?(?:.*&)?categoryId=.*type=EXPENSE|\/app\/operations\?(?:.*&)?type=EXPENSE.*categoryId=/,
  );
  await expect(page.getByText('Аналитический магазин')).toBeVisible();
});

test.describe('Stage 3b mobile routes', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('has no horizontal overflow in dashboard and analytics', async ({ page }) => {
    await registerAndReachApp(page, 'mobile');
    await initializeTemplate(page);

    await page.goto('/app');
    await expect(page.getByText('Всего на счетах')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
    await page.goto('/app/analytics');
    await expect(page.getByRole('heading', { name: 'Отчёты бюджета' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
  });
});

async function registerAndReachApp(page: Page, suffix: string): Promise<void> {
  const email = `stage-3b-${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
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

async function createIncome(page: Page, source: string, amount: string): Promise<void> {
  await page.goto('/app/operations');
  await page.getByRole('button', { name: 'Добавить операцию' }).click();
  await page.getByLabel('Тип операции').selectOption('INCOME');
  await page.getByLabel(/^Счёт\s*\*?$/).selectOption({ label: 'Основная Stage 3b' });
  await page.getByLabel(/^Категория\s*\*?$/).selectOption({ label: 'Шабашка' });
  await page.getByLabel('Источник дохода').fill(source);
  await page.getByLabel('Сумма').fill(amount);
  await page.getByRole('button', { name: 'Подтвердить операцию' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByText('Подтверждена', { exact: true })).toBeVisible();
}

async function createExpense(
  page: Page,
  account: string,
  envelope: string,
  merchant: string,
  amount: string,
): Promise<void> {
  await page.goto('/app/operations');
  await page.getByRole('button', { name: 'Добавить операцию' }).click();
  await page.getByLabel(/^Счёт\s*\*?$/).selectOption({ label: account });
  await page.getByLabel(/^Категория\s*\*?$/).selectOption({ label: 'Продукты' });
  await page.getByLabel(/^Конверт\s*\*?$/).selectOption({ label: envelope });
  await page.getByLabel('Получатель или магазин').fill(merchant);
  await page.getByLabel('Сумма').fill(amount);
  await page.getByRole('button', { name: 'Подтвердить операцию' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByText('Подтверждена', { exact: true })).toBeVisible();
}
