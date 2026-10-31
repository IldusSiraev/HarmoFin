import { expect, test, type Page } from '@playwright/test';

import { mailpitOrigin } from './env';

const password = 'e2e-password-10';

async function register(page: Page): Promise<string> {
  const email = `e2e-mail-${Date.now()}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

test('confirms the address from a Mailpit letter and enables email notifications', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const email = await register(page);

  await page.goto('/app/settings');
  await page.getByRole('link', { name: 'Уведомления на почту' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/notifications$/);
  await expect(page.getByLabel('Присылать уведомления на почту')).toBeDisabled();

  await page.getByRole('button', { name: 'Подтвердить почту' }).click();
  await expect(page.getByText('Ссылка действует 24 часа.')).toBeVisible();

  // Mailpit's list endpoint carries no snippet, so the link is extracted from the
  // full plain-text letter, as in e2e/account-deletion.spec.ts.
  let verifyPath = '';
  await expect
    .poll(async () => {
      const messages = await request
        .get(`${mailpitOrigin}/api/v1/messages`)
        .then((response) => response.json());
      const message = messages.messages.find(
        (item: { To: Array<{ Address: string }>; Subject: string }) =>
          item.Subject === 'Подтвердите почту в HarmoFin' &&
          item.To.some((recipient) => recipient.Address === email),
      ) as { ID: string } | undefined;
      if (!message) return '';
      const full = await request
        .get(`${mailpitOrigin}/api/v1/message/${message.ID}`)
        .then((response) => response.json());
      verifyPath = (full.Text as string).match(/(\/verify-email\?token=[^\s]+)/)?.[1] ?? '';
      return verifyPath;
    })
    .not.toBe('');

  await page.goto(verifyPath);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Почта подтверждена.')).toBeVisible();
  await page.getByRole('button', { name: 'Перейти к настройкам' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/notifications$/);

  await page.getByLabel('Присылать уведомления на почту').check();
  // UiSelect is a custom combobox, selectOption() does not apply: open it and
  // pick the option, like in other specs.
  await page.getByRole('combobox', { name: 'Дайджест событий семьи' }).click();
  await page.getByRole('option', { name: 'Раз в неделю' }).click();
  // Consent guard rolls back input.checked, so check() would see "state did not
  // change"; a plain click opens the dialog and the confirm sets the state.
  await page.getByLabel('Показывать суммы в письмах').click();
  await expect(page.getByRole('dialog', { name: 'Показывать суммы в письмах?' })).toBeVisible();
  await page.getByRole('button', { name: 'Согласен' }).click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки сохранены.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Присылать уведомления на почту')).toBeChecked();
  await expect(page.getByLabel('Показывать суммы в письмах')).toBeChecked();
});

test('the unsubscribe page changes nothing until the button is pressed', async ({ page }) => {
  await page.goto('/unsubscribe?token=unknown-token');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await expect(page).toHaveURL(/\/unsubscribe$/);
  await page.getByRole('button', { name: 'Отписаться' }).click();
  await expect(page.getByText('Письма больше не будут приходить.')).toBeVisible();
});
