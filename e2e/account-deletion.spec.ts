import { expect, test, type Page } from '@playwright/test';
import { mailpitOrigin } from './env';

const password = 'e2e-password-10';

test('deletes the account, blocks sign-in, then restores it through the Mailpit link', async ({
  page,
  request,
}) => {
  // Registration, deletion and sign-in each pay for real Argon2id hashing.
  test.setTimeout(90_000);
  const email = `e2e-delete-${Date.now()}@harmofin.test`;

  await page.goto('/register');
  await waitForHydration(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto('/app/settings');
  await page.getByRole('link', { name: 'Удаление аккаунта' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/delete-account$/);
  await page.getByLabel('Текущий пароль').fill(password);
  await page.getByLabel('Понимаю, что данные удалятся безвозвратно через 30 дней').check();
  await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
  await expect(page).toHaveURL(/\/account-deleted\?until=/);
  await expect(page.getByRole('heading', { name: 'Аккаунт удаляется' })).toBeVisible();

  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);
  await waitForHydration(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/login$/);

  let restorePath = '';
  await expect
    .poll(async () => {
      const messages = await request
        .get(`${mailpitOrigin}/api/v1/messages`)
        .then((response) => response.json());
      const message = messages.messages.find(
        (item: { To: Array<{ Address: string }>; Subject: string }) =>
          item.Subject === 'Аккаунт HarmoFin будет удалён' &&
          item.To.some((recipient) => recipient.Address === email),
      ) as { ID: string } | undefined;
      if (!message) return '';
      const full = await request
        .get(`${mailpitOrigin}/api/v1/message/${message.ID}`)
        .then((response) => response.json());
      restorePath = (full.Text as string).match(/(\/restore-account\?token=[^\s]+)/)?.[1] ?? '';
      return restorePath;
    })
    .not.toBe('');

  await page.goto(restorePath);
  await waitForHydration(page);
  await page.getByRole('button', { name: 'Отменить удаление' }).click();
  await expect(page.getByText('Удаление отменено')).toBeVisible();

  await page.getByRole('link', { name: 'Войти' }).click();
  await waitForHydration(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/app$/);
});

async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
}
