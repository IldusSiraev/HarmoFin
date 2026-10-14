import { expect, test } from '@playwright/test';

const password = 'e2e-password-10';

test('owner creates, edits and archives an account through server-confirmed data', async ({
  page,
}) => {
  await registerAndReachApp(page);

  await page.goto('/app/accounts');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill('Основной счёт');
  await page.getByLabel('Начальный баланс').fill('1 234,50');
  await page.getByLabel('Дата начала учёта').pressSequentially('04092026');
  // A positive opening balance makes the app offer "Назначить деньги" (a drawer).
  const fundingPreview = page.waitForResponse(
    (response) =>
      response.url().includes('/funding/preview') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await dismissFundingOffer(page, fundingPreview);
  await expect(accountCard(page, 'Основной счёт')).toBeVisible();
  await expect(page.getByText(/1.*234.*50/).first()).toBeVisible();

  await accountCard(page, 'Основной счёт').click();
  await expect(page.getByTestId('drawer')).toBeVisible();
  await page.getByTestId('account-drawer-edit').click();
  await page.getByLabel('Название счёта').fill('Основной счёт обновлён');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(accountCard(page, 'Основной счёт обновлён')).toBeVisible();

  await accountCard(page, 'Основной счёт обновлён').click();
  await expect(page.getByTestId('drawer')).toBeVisible();
  const archiveButton = page.getByTestId('account-drawer-archive');
  await archiveButton.click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(archiveButton).toBeFocused();

  // v2: an account with money cannot be archived. The refusal is explained and
  // the confirmation dialog is closed, so it cannot cover the page.
  await archiveButton.click();
  await page.locator('dialog[open] [data-confirm]').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.getByText(/есть остаток/).first()).toBeVisible();

  // An account without a balance is archived and found in the archive filter.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill('Пустой счёт');
  await page.getByLabel('Начальный баланс').fill('0,00');
  await page.getByLabel('Дата начала учёта').pressSequentially('04092026');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(accountCard(page, 'Пустой счёт')).toBeVisible();
  await accountCard(page, 'Пустой счёт').click();
  await expect(page.getByTestId('drawer')).toBeVisible();
  await page.getByTestId('account-drawer-archive').click();
  await page.locator('dialog[open] [data-confirm]').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  await page.getByTestId('chip-archived').click();
  await expect(accountCard(page, 'Пустой счёт').getByTestId('account-row-archived')).toBeVisible();
});

test('shows server validation beside invalid money input', async ({ page }) => {
  await registerAndReachApp(page);
  await page.goto('/app/accounts');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill('Некорректный счёт');
  await page.getByLabel('Начальный баланс').fill('1.234');
  await page.getByLabel('Дата начала учёта').pressSequentially('04092026');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();

  await expect(page.getByText(/денеж|формат|знаков/i)).toBeVisible();
  await expect(page.getByLabel('Начальный баланс')).toHaveAttribute('aria-invalid', 'true');
});

test.describe('compact reference-data navigation', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('reaches reference headings and actions without horizontal overflow', async ({ page }) => {
    await registerAndReachApp(page);
    for (const [path, heading, action] of [
      ['/app/settings', 'Настройки', 'Настроить базовый шаблон'],
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

// The account card is a button named «Открыть счёт «…», баланс …» (AccountRow.vue).
function accountCard(page: import('@playwright/test').Page, name: string) {
  return page
    .getByTestId('account-card-select')
    .filter({ has: page.locator('.account-card__name', { hasText: new RegExp(`^${name}$`) }) });
}

// The opening-money offer is a drawer; postpone it so it cannot cover the page.
async function dismissFundingOffer(
  page: import('@playwright/test').Page,
  preview: Promise<import('@playwright/test').Response>,
): Promise<void> {
  if (!(await preview).ok()) return; // no offer is shown when the preview fails
  const later = page.getByTestId('funding-later');
  await expect(later).toBeVisible({ timeout: 15_000 });
  await later.click();
  await expect(page.getByRole('dialog', { name: 'Назначить деньги' })).toHaveCount(0);
}

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
