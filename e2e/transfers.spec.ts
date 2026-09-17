import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

test('owner confirms multipart transfer with explicit envelope reallocation', async ({ page }) => {
  const references = await registerInitializeAndCreateTransferReferences(page, 'multipart');

  await page.goto('/app/accounts');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  // The transfer link now lives behind the row's action menu instead of being
  // a card-level link, so the menu has to be opened first.
  await page
    .locator('li')
    .filter({ hasText: references.sourceAccount })
    .getByRole('button', { name: 'Действия над счётом' })
    .click();
  await page.getByTestId('row-transfer').click();
  await expect(page).toHaveURL(/\/app\/transfers\?sourceAccountId=/);
  await waitForHydration(page);
  await expect(page.getByRole('button', { name: 'Новый перевод' })).toBeEnabled();
  await page.getByRole('button', { name: 'Новый перевод' }).click();
  const sourceAccountId = new URL(page.url()).searchParams.get('sourceAccountId');
  await expect(page.getByLabel('Счёт списания')).toHaveValue(sourceAccountId ?? '');
  await page.getByLabel('Счёт зачисления').selectOption({ label: references.destinationAccount });
  await page.getByLabel('Общая сумма').fill('20 000,00');
  await page
    .getByLabel('Конверт списания части 1')
    .selectOption({ label: references.sourceEnvelope });
  await page.getByLabel('Сумма части 1').fill('15 000,00');
  await page.getByRole('button', { name: 'Добавить часть' }).click();
  await page
    .getByLabel('Конверт списания части 2')
    .selectOption({ label: references.sourceEnvelope });
  await page.getByLabel('Конверт зачисления части 2').selectOption({
    label: references.destinationEnvelope,
  });
  await page.getByLabel('Сумма части 2').fill('5 000,00');
  await page.getByRole('button', { name: 'Подтвердить перевод' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();

  await expect(page.getByText('Перевод подтверждён.')).toBeVisible();
  await expect(page.getByText('Подтверждён', { exact: true })).toBeVisible();
  await expect(page.getByText('Затронуто конвертов: 2')).toBeVisible();
});

test('shows mismatch and insufficient-balance errors without duplicate transfer', async ({
  page,
}) => {
  const references = await registerInitializeAndCreateTransferReferences(page, 'validation');

  await page.goto('/app/transfers');
  await waitForHydration(page);
  await expect(page.getByRole('button', { name: 'Новый перевод' })).toBeEnabled();
  await page.getByRole('button', { name: 'Новый перевод' }).click();
  await fillTransfer(page, references, '20,00', '10,00');
  await page.getByRole('button', { name: 'Создать черновик' }).click();
  await expect(page.getByRole('alert').first()).toContainText('Укажите данные формы.');
  await expect(page.getByText('Сумма частей должна совпадать с общей суммой.')).toBeVisible();

  await page.getByLabel('Общая сумма').fill('1 000 001,00');
  await page.getByLabel('Сумма части 1').fill('1 000 001,00');
  await page.getByRole('button', { name: 'Подтвердить перевод' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText(
    'Не удалось сохранить перевод. Повторите попытку.',
  );
  await expect(page.getByText('Подтверждён', { exact: true })).toHaveCount(0);
});

test('replays same browser idempotency request once, cancels draft and deletes confirmed transfer', async ({
  page,
}) => {
  const references = await registerInitializeAndCreateTransferReferences(page, 'lifecycle');

  await page.goto('/app/transfers');
  await waitForHydration(page);
  await expect(page.getByRole('button', { name: 'Новый перевод' })).toBeEnabled();
  await page.getByRole('button', { name: 'Новый перевод' }).click();
  await fillTransfer(page, references, '10,00', '10,00');
  const requestPromise = page.waitForRequest(
    (request) => request.method() === 'POST' && /\/transfers$/.test(request.url()),
  );
  await page.getByRole('button', { name: 'Создать черновик' }).click();
  const request = await requestPromise;
  await expect(page.getByText('Черновик', { exact: true })).toHaveCount(1);

  const replay = await page.evaluate(
    async ({ url, body, idempotencyKey }) => {
      const csrf = (await fetch('http://localhost:3001/api/v1/auth/csrf', {
        credentials: 'include',
      }).then((response) => response.json())) as { csrfToken: string };
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf.csrfToken,
          'Idempotency-Key': idempotencyKey,
        },
        body,
      });
      return { status: response.status, body: await response.json() };
    },
    {
      url: request.url(),
      body: request.postData() ?? '',
      idempotencyKey: request.headers()['idempotency-key'] ?? '',
    },
  );
  expect(replay.status).toBe(201);
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByText('Черновик', { exact: true })).toHaveCount(1);

  await page.getByRole('button', { name: 'Отменить' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Отменить' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByText('Отменён', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Новый перевод' }).click();
  await fillTransfer(page, references, '10,00', '10,00');
  await page.getByRole('button', { name: 'Подтвердить перевод' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByText('Подтверждён', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Удалить' }).last().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByText('Удалён', { exact: true })).toBeVisible();
});

test.describe('transfers mobile route', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('redirects protected route and fits list and form without horizontal overflow', async ({
    page,
  }) => {
    await page.goto('/app/transfers');
    await expect(page).toHaveURL(/\/login$/);
    await registerAndReachApp(page);
    await page.goto('/app/transfers');
    await waitForHydration(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Переводы');
    await page.getByRole('button', { name: 'Новый перевод' }).click();
    await expect(page.getByLabel('Общая сумма')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
  });
});

async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
}

async function registerInitializeAndCreateTransferReferences(page: Page, suffix: string) {
  await registerAndReachApp(page);
  await initializeTemplate(page);
  const sourceAccount = `Основной ${suffix}`;
  const destinationAccount = `Накопительный ${suffix}`;
  const sourceEnvelope = `Ремонт ${suffix}`;
  const destinationEnvelope = `Обязательные ${suffix}`;
  await createAccount(page, sourceAccount, '1 000 000,00');
  await createAccount(page, destinationAccount, '100,00');
  await createEnvelope(page, sourceEnvelope, '1 000 000,00', '10');
  await createEnvelope(page, destinationEnvelope, '0,00', '11');
  return { sourceAccount, destinationAccount, sourceEnvelope, destinationEnvelope };
}

async function fillTransfer(
  page: Page,
  references: {
    sourceAccount: string;
    destinationAccount: string;
    sourceEnvelope: string;
  },
  total: string,
  partAmount: string,
): Promise<void> {
  await page.getByLabel('Счёт списания').selectOption({ label: references.sourceAccount });
  await page.getByLabel('Счёт зачисления').selectOption({ label: references.destinationAccount });
  await page.getByLabel('Общая сумма').fill(total);
  await page
    .getByLabel('Конверт списания части 1')
    .selectOption({ label: references.sourceEnvelope });
  await page.getByLabel('Сумма части 1').fill(partAmount);
}

async function registerAndReachApp(page: Page): Promise<void> {
  const email = `transfer-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function initializeTemplate(page: Page): Promise<void> {
  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Создать базовый шаблон' }).click();
  await expect(page.getByText('Базовый шаблон создан.')).toBeVisible();
}

async function createAccount(page: Page, name: string, balance: string): Promise<void> {
  await page.goto('/app/accounts');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill(name);
  await page.getByLabel('Начальный баланс').fill(balance);
  await page.getByLabel('Дата начала учёта').fill('2026-09-04');
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(page.getByText(name)).toBeVisible();
}

async function createEnvelope(
  page: Page,
  name: string,
  balance: string,
  displayOrder: string,
): Promise<void> {
  await page.goto('/app/envelopes');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Создать конверт' }).first().click();
  await page.getByLabel('Название конверта').fill(name);
  await page.getByLabel('Начальный баланс').fill(balance);
  await page.getByLabel('Порядок отображения').fill(displayOrder);
  await page.getByRole('button', { name: 'Сохранить конверт' }).click();
  await expect(page.getByText(name)).toBeVisible();
}
