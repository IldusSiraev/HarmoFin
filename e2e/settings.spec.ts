import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';
const newPassword = 'e2e-password-11';

test('owner walks the settings hub into every sub-page, changes the password and revokes a session', async ({
  page,
}) => {
  // Registration and the password change both pay for real Argon2id hashing,
  // on top of a dozen navigations — well past the 10s default.
  test.setTimeout(90_000);
  await registerAndReachApp(page);
  await openHub(page);

  // «Бюджет» → «Общие настройки» → back.
  await page.getByRole('link', { name: 'Общие настройки' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/general$/);
  await expect(page.getByLabel('Название бюджета')).toBeVisible();
  await backToHub(page);

  // «Аккаунт» → «Пароль» → back.
  await page.getByRole('link', { name: 'Пароль' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/password$/);
  await expect(page.getByLabel('Текущий пароль')).toBeVisible();
  await backToHub(page);

  // «Аккаунт» → «Сессии» → back.
  await page.getByRole('link', { name: 'Сессии' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/sessions$/);
  await expect(page.locator('[data-action="revoke-all"]')).toBeVisible();
  await backToHub(page);

  // The password change itself, on the sub-page reached through the hub.
  await page.getByRole('link', { name: 'Пароль' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/password$/);
  await page.getByLabel('Текущий пароль').fill(password);
  await page.locator('input[name="newPassword"]').fill(newPassword);
  await page.getByLabel('Подтвердите новый пароль').fill(newPassword);
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Пароль изменён.')).toBeVisible();

  // The session list is server data, so the session made by registering is there.
  await page.goto('/app/settings/sessions');
  const revokeButtons = page.locator('[data-action="revoke-session"]');
  await expect(revokeButtons.first()).toBeVisible();

  // Only this browser's session exists, so revoking it signs us out.
  await revokeButtons.first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Не удалось завершить сессию. Повторите попытку.')).toHaveCount(0);
});

test('mismatched password confirmation is refused before reaching the API', async ({ page }) => {
  test.setTimeout(60_000);
  await registerAndReachApp(page);
  await openHub(page);

  await page.getByRole('link', { name: 'Пароль' }).click();
  await expect(page.getByLabel('Текущий пароль')).toBeVisible();
  await page.getByLabel('Текущий пароль').fill(password);
  await page.locator('input[name="newPassword"]').fill(newPassword);
  await page.getByLabel('Подтвердите новый пароль').fill('e2e-password-12');
  await page.getByRole('button', { name: 'Сохранить' }).click();

  await expect(page.getByText('Пароли не совпадают.')).toBeVisible();
  await expect(page.getByLabel('Подтвердите новый пароль')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Пароль изменён.')).toHaveCount(0);
});

// The hub renders its cards only after the client-side load resolves, so the
// heading below doubles as the hydration gate for every click that follows.
async function openHub(page: Page): Promise<void> {
  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Настройки');
}

async function backToHub(page: Page): Promise<void> {
  await page.getByRole('link', { name: '← Настройки' }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Настройки');
}

async function registerAndReachApp(page: Page): Promise<void> {
  const email = `settings-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
}
