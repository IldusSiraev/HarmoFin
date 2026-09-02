import { expect, test } from '@playwright/test';

const email = `e2e-${Date.now()}@harmofin.test`;
const password = 'e2e-password-10';

test('registers, protects app, logs out, and logs back in', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/register');
  await waitForHydration(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Мой бюджет');
  await expect(page.evaluate(() => Object.keys(localStorage))).resolves.not.toContain('auth');

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await waitForHydration(page);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test('shows generic recovery acknowledgement', async ({ page }) => {
  await page.goto('/forgot-password');
  await waitForHydration(page);
  await page.getByLabel('Email').fill(`unknown-${Date.now()}@harmofin.test`);
  await page.getByRole('button', { name: 'Отправить ссылку' }).click();

  await expect(page.getByRole('status')).toHaveText(
    'Если аккаунт существует, ссылка для восстановления отправлена на email.',
  );
});

test('resets password through a Mailpit recovery link', async ({ page, request }) => {
  await page.goto('/forgot-password');
  await waitForHydration(page);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Отправить ссылку' }).click();
  await expect(page.getByRole('status')).toBeVisible();

  let resetPath = '';
  await expect
    .poll(async () => {
      const messages = await request
        .get('http://localhost:8025/api/v1/messages')
        .then((response) => response.json());
      const message = messages.messages.find(
        (item: { To: Array<{ Address: string }>; Snippet: string }) =>
          item.To.some((recipient) => recipient.Address === email),
      ) as { Snippet: string } | undefined;
      const match = message?.Snippet.match(
        /http:\/\/localhost:3000(\/reset-password\?token=[^\s]+)/,
      );
      resetPath = match?.[1] ?? '';
      return resetPath;
    })
    .not.toBe('');

  await page.goto(resetPath);
  await waitForHydration(page);
  await page.getByRole('textbox', { name: 'Новый пароль' }).fill('new-e2e-password-10');
  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page).toHaveURL(/\/app$/);
});

async function waitForHydration(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
}
