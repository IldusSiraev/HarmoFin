import { expect, test, type Page } from '@playwright/test';

import { apiV1 } from './env';

const password = 'e2e-password-10';
const webhookSecret = 'e2e-only-webhook-secret-with-32-chars';

async function register(page: Page): Promise<void> {
  const email = `e2e-telegram-${Date.now()}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test('links Telegram through the bot webhook, enables the channel and unlinks', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await register(page);

  await page.goto('/app/settings');
  await page.getByRole('link', { name: 'Уведомления в Telegram' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/telegram$/);

  const connect = page.getByRole('button', { name: 'Подключить Telegram' });
  await expect(connect).toBeDisabled();
  await page.getByLabel('Согласен на отправку уведомлений через Telegram').check();
  await connect.click();

  const open = page.getByRole('link', { name: /Открыть Telegram/ });
  await expect(open).toBeVisible();
  const code = new URL((await open.getAttribute('href'))!).searchParams.get('start');
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // Telegram calls the webhook without Origin: the request fixture sends none either.
  const chatId = Date.now();
  const update = await request.post(`${apiV1}/telegram/webhook`, {
    headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
    data: {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: chatId, type: 'private' },
        text: `/start ${code}`,
      },
    },
  });
  expect(update.status()).toBe(200);

  // The page polls every 3 seconds.
  await expect(page.getByText('Telegram подключён.')).toBeVisible();
  await page.getByLabel('Присылать уведомления в Telegram').check();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки сохранены.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Присылать уведомления в Telegram')).toBeChecked();

  await expect(page.getByText('Команды выключены.')).toBeVisible();
  const enableCommands = page.getByRole('button', { name: 'Включить команды' });
  await expect(enableCommands).toBeDisabled();
  await page.getByLabel(/Я согласен включить команды бота/).check();
  await enableCommands.click();
  await expect(page.getByText('Команды включены.')).toBeVisible();

  // The reply goes to the closed port of TELEGRAM_API_BASE_URL in CI; the webhook still answers 200.
  const balance = await request.post(`${apiV1}/telegram/webhook`, {
    headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
    data: {
      update_id: 2,
      message: { message_id: 2, chat: { id: chatId, type: 'private' }, text: '/balance' },
    },
  });
  expect(balance.status()).toBe(200);

  await page.getByRole('button', { name: 'Отключить Telegram' }).click();
  await page
    .getByRole('dialog', { name: 'Отключить Telegram?' })
    .getByRole('button', { name: 'Отключить', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Подключить Telegram' })).toBeVisible();
});

test('rejects a webhook call without the secret', async ({ request }) => {
  const response = await request.post(`${apiV1}/telegram/webhook`, { data: { update_id: 2 } });
  expect(response.status()).toBe(401);
});
