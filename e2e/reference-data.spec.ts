import { expect, test } from '@playwright/test';

const password = 'e2e-password-10';

test('owner initializes template and manages account through server-confirmed data', async ({
  page,
}) => {
  await registerAndReachApp(page);

  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Бюджет');
  await page.getByRole('button', { name: 'Создать базовый шаблон' }).click();
  await expect(page.getByText('Базовый шаблон создан.')).toBeVisible();
  await page.getByRole('button', { name: 'Создать базовый шаблон' }).click();
  await expect(page.getByText('Базовый шаблон создан.')).toBeVisible();
  await page.getByLabel('Часовой пояс').fill('Europe/Moscow');
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(page.getByText('Настройки бюджета сохранены.')).toBeVisible();

  await page.goto('/app/categories');
  await expect(page.getByText('Зарплата')).toHaveCount(1);

  await page.goto('/app/accounts');
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill('Основной счёт');
  await page.getByLabel('Начальный баланс').fill('1 234,50');
  await page.getByLabel('Дата начала учёта').fill('2026-09-04');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(page.getByText('Основной счёт')).toBeVisible();
  await expect(page.getByText(/1.*234.*50/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Название счёта').fill('Основной счёт обновлён');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(page.getByText('Основной счёт обновлён')).toBeVisible();

  const archiveButton = page.getByRole('button', { name: 'Переместить в архив' });
  await archiveButton.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(archiveButton).toBeFocused();

  await archiveButton.click();
  await page.getByRole('button', { name: 'Архивировать счёт' }).click();
  await page.getByLabel('Показать счета').selectOption('archived');
  await expect(page.getByRole('article').getByText('В архиве')).toBeVisible();
});

test('owner creates typed categories and envelope without client balance arithmetic', async ({
  page,
}) => {
  await registerAndReachApp(page);

  await page.goto('/app/categories');
  await page.getByRole('button', { name: 'Создать категорию' }).click();
  await page.getByLabel('Название категории').fill('Зарплата');
  await page.getByLabel('Порядок отображения').fill('1');
  await page.getByRole('button', { name: 'Сохранить категорию' }).click();
  await expect(page.getByRole('heading', { name: 'Зарплата' })).toBeVisible();

  await page.getByRole('button', { name: 'Создать категорию' }).click();
  await page.getByLabel('Тип категории').selectOption('EXPENSE');
  await page.getByLabel('Название категории').fill('Продукты');
  await page.getByLabel('Порядок отображения').fill('2');
  await page.getByRole('button', { name: 'Сохранить категорию' }).click();
  await expect(page.getByRole('heading', { name: 'Продукты' })).toBeVisible();

  await page.goto('/app/envelopes');
  await page.getByRole('button', { name: 'Создать конверт' }).first().click();
  await page.getByLabel('Название конверта').fill('Накопления');
  await page.getByLabel('Тип конверта').selectOption('SAVINGS_GOAL');
  await page.getByLabel('Начальный баланс').fill('123,45');
  await page.getByLabel('Порядок отображения').fill('1');
  await page.getByRole('button', { name: 'Сохранить конверт' }).click();
  await expect(page.getByText('Накопления')).toBeVisible();
  await expect(page.getByText(/123.*45/).first()).toBeVisible();
});

test('shows server validation beside invalid money input', async ({ page }) => {
  await registerAndReachApp(page);
  await page.goto('/app/accounts');
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill('Некорректный счёт');
  await page.getByLabel('Начальный баланс').fill('1.234');
  await page.getByLabel('Дата начала учёта').fill('2026-09-04');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();

  await expect(page.getByText(/денеж|формат|знаков/i)).toBeVisible();
  await expect(page.getByLabel('Начальный баланс')).toHaveAttribute('aria-invalid', 'true');
});

test.describe('compact reference-data navigation', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('reaches reference headings and actions without horizontal overflow', async ({ page }) => {
    await registerAndReachApp(page);
    for (const [path, heading, action] of [
      ['/app/settings', 'Бюджет', 'Создать базовый шаблон'],
      ['/app/accounts', 'Счета', 'Создать счёт'],
      ['/app/categories', 'Категории', 'Создать категорию'],
      ['/app/envelopes', 'Конверты', 'Создать конверт'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      await expect(page.getByRole('button', { name: action }).first()).toBeVisible();
      const documentWidth = await page.evaluate(() => String(document.documentElement.scrollWidth));
      expect(Number(documentWidth)).toBeLessThanOrEqual(375);
    }
  });
});

test('redirects protected reference route when session is absent', async ({ page }) => {
  await page.goto('/app/accounts');
  await expect(page).toHaveURL(/\/login$/);
});

async function registerAndReachApp(page: import('@playwright/test').Page): Promise<void> {
  const email = `reference-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
  await page.goto('/register');
  await waitForHydration(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function waitForHydration(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
}
