import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';
// Device keys in the browser's format (0x04 + 64 bytes; 16 bytes). Not a real device.
const deviceKeys = {
  p256dh: 'BAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  auth: 'AgICAgICAgICAgICAgICAg',
};

async function register(page: Page): Promise<void> {
  const email = `e2e-push-${Date.now()}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

/**
 * The dev server registers no service worker and CI has no push service: Notification,
 * the registration and its PushManager are replaced before any page script runs.
 */
async function fakePush(page: Page): Promise<void> {
  await page.addInitScript((keys) => {
    let permission: NotificationPermission = 'default';
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      get: () => permission,
    });
    Object.defineProperty(Notification, 'requestPermission', {
      configurable: true,
      value: async () => {
        permission = 'granted';
        return permission;
      },
    });
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2)}`;
    const subscription = {
      endpoint,
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint, expirationTime: null, keys }),
      unsubscribe: async () => {
        current = null;
        return true;
      },
    };
    let current: typeof subscription | null = null;
    const registration = {
      pushManager: {
        getSubscription: async () => current,
        subscribe: async () => {
          current = subscription;
          return subscription;
        },
      },
    };
    Object.defineProperty(navigator.serviceWorker, 'getRegistration', {
      configurable: true,
      value: async () => registration,
    });
  }, deviceKeys);
}

test('enables push on this device, picks the types and disconnects it', async ({ page }) => {
  test.setTimeout(90_000);
  await fakePush(page);
  await register(page);

  await page.goto('/app/settings');
  await page.getByRole('link', { name: 'Push-уведомления' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/push$/);

  await page.getByRole('button', { name: 'Включить на этом устройстве' }).click();
  await expect(page.getByText('Уведомления включены на этом устройстве.')).toBeVisible();
  await expect(page.getByText('Это устройство')).toBeVisible();
  await expect(page.getByLabel('Присылать push-уведомления')).toBeChecked();

  await page.getByLabel('Напоминания календаря').uncheck();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки сохранены.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Просроченные платежи')).toBeChecked();
  await expect(page.getByLabel('Напоминания календаря')).not.toBeChecked();

  await page.getByRole('button', { name: /^Отключить / }).click();
  await expect(page.getByRole('button', { name: 'Включить на этом устройстве' })).toBeVisible();
});
