import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

test.describe('reference lists on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the accounts list free of horizontal overflow', async ({ page }) => {
    await registerAndReachApp(page, 'reference-phone');
    await createAccount(page, 'Карта телефона с длинным названием', '10 000,00');

    await page.goto('/app/accounts');
    await expect(page.getByTestId('account-card-select').first()).toBeVisible();
    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement;
      return root ? root.scrollWidth - root.clientWidth : 0;
    });
    expect(overflow).toBeLessThanOrEqual(0);
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

async function createAccount(page: Page, name: string, balance: string): Promise<void> {
  await page.goto('/app/accounts');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill(name);
  await page.getByLabel('Начальный баланс').fill(balance);
  await page.getByLabel('Дата начала учёта').pressSequentially('04092026');
  // Before the first assignment no "Распределить деньги" dialog opens after saving.
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(page.getByRole('dialog', { name: 'Распределить деньги' })).toHaveCount(0);
  await expect(page.getByTestId('account-card-select').first()).toBeVisible();
}
