import { expect, test, type Page } from '@playwright/test';
import { apiMutate } from './api-mutate';
import { apiOrigin, apiV1 } from './env';

// Transfer created from the account dialog's global entry sheet must show up
// in the journal's "Переводы" tab, support edit/delete/restore there, and keep
// account balances server-correct throughout. Setup goes through the API and
// is marked "SETUP". Amounts are synthetic.

const password = 'e2e-password-10';
const API_V2 = `${apiOrigin}/api/v2`;

interface MeResponse {
  workspaces: Array<{ budgets: Array<{ id: string; planModelVersion: number }> }>;
}
interface AccountDto {
  id: string;
  name: string;
  currentBalanceMinor: string;
}

test('v2: перевод в журнале — создать, изменить, удалить и восстановить', async ({ page }) => {
  test.setTimeout(180_000);
  await registerAndReachApp(page);
  const budgetId = await budgetIdOf(page);
  const base = `${apiV1}/budgets/${budgetId}`;
  const today = new Date().toISOString().slice(0, 10);

  // SETUP (API): два счёта, на первом 10 000 ₽.
  await apiMutate<AccountDto>(page, `${base}/accounts`, {
    name: 'Карта',
    accountType: 'BANK_CARD',
    currency: 'RUB',
    startingBalance: '10000.00',
    accountingStartDate: today,
  });
  const deposit = await apiMutate<AccountDto>(page, `${base}/accounts`, {
    name: 'Вклад',
    accountType: 'BANK_ACCOUNT',
    currency: 'RUB',
    startingBalance: '0.00',
    accountingStartDate: today,
  });

  // Создать перевод из карточки счёта: кнопка открывает глобальный диалог
  // операций с предзаполненным счётом списания.
  await page.goto('/app/accounts');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: /Открыть счёт «Карта»/ }).click();
  await page.getByTestId('account-dialog-transfer').click();
  const entry = page.getByRole('dialog');
  await entry.getByLabel('Сумма').fill('1 500,00');
  // By test id: the accessible name «Куда» also matches «Откуда» as a substring.
  await entry.getByTestId(`pill-transferDestination-${deposit.id}`).click();
  await page.getByTestId('entry-submit').click();
  await expect(entry).toBeHidden();

  // Журнал: вкладка «Переводы». The page renders server-side first, so wait
  // for client-hydrated toolbar content before driving it (see app-shell.spec.ts).
  await page.goto('/app/operations');
  const transferTab = page.getByTestId('type-tab-TRANSFER');
  await expect(transferTab).toBeVisible();
  await transferTab.click();
  const row = page.getByRole('button', { name: /Открыть перевод Карта → Вклад/ });
  await expect(row).toBeVisible();

  // Изменить сумму и комментарий.
  await row.click();
  await page.getByTestId('transfer-dialog-edit').click();
  await page.getByLabel('Сумма').fill('2 000,00');
  await page.getByLabel('Комментарий').fill('Отпуск');
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(page.getByText('Отпуск')).toBeVisible();
  const afterEdit = await getJson<AccountDto[]>(page, `${base}/accounts`);
  expect(afterEdit.find((a) => a.id === deposit.id)?.currentBalanceMinor).toBe('200000');

  // Удалить: строка пропадает, баланс вклада возвращается к нулю.
  await page.getByRole('button', { name: /Открыть перевод Карта → Вклад/ }).click();
  await page.getByTestId('transfer-dialog-delete').click();
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('button', { name: /Открыть перевод Карта → Вклад/ })).toHaveCount(0);
  const afterDelete = await getJson<AccountDto[]>(page, `${base}/accounts`);
  expect(afterDelete.find((a) => a.id === deposit.id)?.currentBalanceMinor).toBe('0');

  // Восстановить из фильтра «Удалённые».
  await page.goto('/app/operations?type=TRANSFER&status=DELETED');
  await expect(page.getByTestId('type-tab-TRANSFER')).toBeVisible();
  await page.getByRole('button', { name: /Открыть перевод Карта → Вклад/ }).click();
  await page.getByTestId('transfer-dialog-restore').click();
  // Navigating right after the click could abort the restore request or list
  // before it commits; wait for the server to confirm the restore first.
  const restored = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/transfers\/[^/]+\/restore$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  expect((await restored).ok()).toBe(true);
  await page.goto('/app/operations?type=TRANSFER');
  await expect(page.getByTestId('type-tab-TRANSFER')).toBeVisible();
  await expect(page.getByRole('button', { name: /Открыть перевод Карта → Вклад/ })).toBeVisible();
  const afterRestore = await getJson<AccountDto[]>(page, `${base}/accounts`);
  expect(afterRestore.find((a) => a.id === deposit.id)?.currentBalanceMinor).toBe('200000');
});

async function getJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `${url} -> ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

async function budgetIdOf(page: Page): Promise<string> {
  const me = await getJson<MeResponse>(page, `${apiV1}/me`);
  const budget = me.workspaces[0]?.budgets[0];
  if (!budget) throw new Error('Missing budget');
  expect(budget.planModelVersion).toBe(2);
  return budget.id;
}

async function registerAndReachApp(page: Page): Promise<void> {
  const email = `v2-transfers-journal-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
}
