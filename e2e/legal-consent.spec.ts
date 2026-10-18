import { expect, test } from '@playwright/test';
import { apiV1, webOrigin } from './env';

const password = 'e2e-password-10';

test('registration requires both consents and documents are public', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Политика обработки персональных данных',
  );
  await page.goto('/consent');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Согласие на обработку персональных данных',
  );

  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(`e2e-legal-${Date.now()}@harmofin.test`);
  await page.getByLabel('Пароль').fill(password);
  const submit = page.getByRole('button', { name: 'Создать аккаунт' });
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\/app$/);
});

test('a user without consents is held on the acceptance screen', async ({ page, request }) => {
  const email = `e2e-noconsent-${Date.now()}@harmofin.test`;
  // API registration without the optional consents field, as an older client would do.
  const registered = await request.post(`${apiV1}/auth/register`, {
    headers: { origin: webOrigin },
    data: { email, password },
  });
  expect(registered.status()).toBe(201);

  await page.goto('/login');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/accept-terms$/);

  await page.goto('/app');
  await expect(page).toHaveURL(/\/accept-terms$/);

  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.getByRole('button', { name: 'Принять и продолжить' }).click();
  await expect(page).toHaveURL(/\/app$/);
});
