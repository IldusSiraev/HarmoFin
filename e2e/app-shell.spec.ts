import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

test('adds an operation from a page other than the dashboard', async ({ page }) => {
  await registerAndReachApp(page, 'shell');
  await initializeTemplate(page);

  await page.goto('/app/operations');
  await page.getByTestId('add-menu-trigger').click();
  await page.getByTestId('add-menu-expense').click();

  await expect(page.getByRole('dialog')).toBeVisible();
});

test('shows a toast after a reference record is created', async ({ page }) => {
  await registerAndReachApp(page, 'toast');
  await initializeTemplate(page);

  await page.goto('/app/accounts');
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill('Карта для тоста');
  await page.getByLabel('Начальный баланс').fill('1 000,00');
  await page.getByLabel('Дата начала учёта').fill('2026-09-04');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();

  await expect(page.getByTestId('toast-stack')).toContainText('Счёт создан');
});

test.describe('app shell on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the dashboard order and bottom navigation', async ({ page }) => {
    await registerAndReachApp(page, 'phone');
    await initializeTemplate(page);

    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Можно потратить' })).toBeVisible();
    await expect(page.getByTestId('bottom-nav-add')).toBeVisible();

    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement;
      return root ? root.scrollWidth - root.clientWidth : 0;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

async function registerAndReachApp(page: Page, suffix: string): Promise<void> {
  const email = `app-shell-${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
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
