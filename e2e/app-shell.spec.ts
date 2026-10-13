import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

test('adds an operation from a page other than the dashboard', async ({ page }) => {
  await registerAndReachApp(page, 'shell');

  await page.goto('/app/operations');
  // The shell renders server-side, so its buttons are clickable before Vue has
  // hydrated them; wait for content the client renders before driving the menu.
  await expect(
    page.getByRole('main').getByRole('button', { name: 'Добавить операцию' }),
  ).toBeVisible();

  // The shell mounts the menu twice — header and sidebar — and CSS hides one of
  // them per width, so pick whichever copy this viewport actually shows.
  const trigger = page.getByTestId('add-menu-trigger').filter({ visible: true });
  await trigger.click();
  await page.getByTestId('operation-type-expense').click();

  await expect(page.getByRole('dialog', { name: 'Новая операция' })).toBeVisible();
  await expect(page.getByLabel('Сумма')).toBeVisible();
  await expect(page.getByTestId('entry-tab-EXPENSE')).toHaveAttribute('aria-selected', 'true');
});

test('shows a toast after a reference record is created', async ({ page }) => {
  await registerAndReachApp(page, 'toast');

  await page.goto('/app/accounts');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill('Карта для тоста');
  await page.getByLabel('Начальный баланс').fill('1 000,00');
  await page.getByLabel('Дата начала учёта').pressSequentially('04092026');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();

  await expect(page.getByTestId('toast-stack')).toContainText('Счёт создан');
});

test.describe('app shell on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the dashboard order and bottom navigation', async ({ page }) => {
    await registerAndReachApp(page, 'phone');

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
