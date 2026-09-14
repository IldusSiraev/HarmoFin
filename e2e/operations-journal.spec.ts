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
  await page.getByLabel('Статус').selectOption('DELETED');
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
  await page.getByTestId('add-menu-trigger').filter({ visible: true }).click();
  await page.getByTestId('add-menu-income').filter({ visible: true }).click();

  await expect(page.getByLabel('Тип операции')).toHaveValue('INCOME');
  await page.getByLabel(/^Счёт\s*\*?$/).selectOption({ label: 'Карта из оболочки' });
  await page.getByLabel(/^Категория\s*\*?$/).selectOption({ label: 'Шабашка' });
  await page.getByLabel('Источник дохода').fill('Доход из оболочки');
  await page.getByLabel('Сумма').fill('500,00');
  await page.getByRole('button', { name: 'Создать черновик' }).click();

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
    await createDraftExpense(page, 'Карта телефона', 'Текущие телефона', 'Магазин', '100,00');

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
  await page.getByLabel(/^Счёт\s*\*?$/).selectOption({ label: account });
  await page.getByLabel(/^Категория\s*\*?$/).selectOption({ label: 'Продукты' });
  await page.getByLabel(/^Конверт\s*\*?$/).selectOption({ label: envelope });
  await page.getByLabel('Получатель или магазин').fill(merchant);
  await page.getByLabel('Сумма').fill(amount);
  await page.getByRole('button', { name: 'Создать черновик' }).click();
  await expect(page.getByText('Черновик', { exact: true })).toBeVisible();
}
