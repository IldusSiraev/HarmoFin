import { expect, test, type Page } from '@playwright/test';
import { apiMutate } from './api-mutate';
import { apiOrigin, apiV1 } from './env';

// Envelope Plan v2.2: the "Планы" page creates an obligation plan and an
// expected-income plan through the dialog. A plan is a stated intention, not a
// movement of money: no operation appears and the account balance is unchanged.
// Setup (the base template that gives the categories) goes through the API and
// is marked "SETUP"; the plans themselves are created through the UI and read
// back with API GETs. Amounts are synthetic; the database is never read.

const password = 'e2e-password-10';
const API_V2 = `${apiOrigin}/api/v2`;

interface MeResponse {
  workspaces: Array<{ budgets: Array<{ id: string; planModelVersion: number }> }>;
}
interface TemplatePreview {
  previewHash: string;
}
interface ItemList {
  items: Array<{ id: string; name: string }>;
}
interface Dashboard {
  cashMinor: string;
  onboarding: { hasMandatoryPlans: boolean };
}

for (const [label, viewport] of [
  ['desktop 1280px', { width: 1280, height: 800 }],
  ['mobile 390px', { width: 390, height: 844 }],
] as const) {
  test.describe(label, () => {
    test.use({ viewport });

    test('plans page: add a mandatory payment and an expected income without creating operations', async ({
      page,
    }) => {
      test.setTimeout(180_000);

      await registerAndReachApp(page);
      const budgetId = await budgetIdOf(page);
      const base = `${API_V2}/budgets/${budgetId}`;

      // SETUP (API): the base template gives expense and income categories.
      const preview = await getJson<TemplatePreview>(page, `${base}/reference-template/preview`);
      await apiMutate(page, `${base}/reference-template/apply`, {
        previewHash: preview.previewHash,
        periods: [
          { role: 'FIRST', action: 'CREATE' },
          { role: 'SECOND', action: 'CREATE' },
        ],
        mandatory: { action: 'CREATE' },
        savings: [],
      });
      const before = await getJson<Dashboard>(page, `${base}/dashboard`);
      expect(before.onboarding.hasMandatoryPlans).toBe(false);

      // 1. Empty page: add a payment from the header button.
      await page.goto('/app/plans');
      await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
      await expect(page.getByTestId('obligation-list')).toContainText(
        'Обязательных платежей пока нет.',
      );
      await expect(page.getByTestId('income-list')).toContainText(
        'Здесь будут ожидаемые поступления.',
      );
      await page.getByRole('button', { name: 'Добавить платёж' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Создать план' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('tab', { name: 'Платёж' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(dialog).toContainText('План ничего не списывает');

      await dialog.getByLabel('Сумма').fill('45000');
      await dialog.getByLabel('Название').fill('Аренда');
      await dialog
        .getByRole('radiogroup', { name: 'Категория' })
        .getByRole('radio')
        .first()
        .click();
      await dialog.getByRole('button', { name: 'Добавить платёж' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('status')).toContainText('Платёж «Аренда» добавлен.');
      await expect(page.getByTestId('obligation-list')).toContainText('Аренда');

      // 2. API: the plan exists, but no operation was created.
      const occurrences = await getJson<ItemList>(page, `${base}/obligations/occurrences`);
      expect(occurrences.items.some((item) => item.name === 'Аренда')).toBe(true);
      const journal = await getJson<ItemList>(page, `${base}/transactions?limit=100`);
      expect(journal.items).toHaveLength(0);
      const afterPayment = await getJson<Dashboard>(page, `${base}/dashboard`);
      expect(afterPayment.onboarding.hasMandatoryPlans).toBe(true);
      expect(afterPayment.cashMinor).toBe(before.cashMinor);

      // 3. Expected income from the empty state: it is a forecast only.
      await page.getByRole('button', { name: 'Добавить доход' }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('tab', { name: 'Доход' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(dialog).toContainText('План ничего не добавляет на счёт');
      await dialog.getByLabel('Сумма').fill('100000');
      await dialog.getByLabel('Название').fill('Зарплата');
      await dialog
        .getByRole('radiogroup', { name: 'Категория' })
        .getByRole('radio')
        .first()
        .click();
      await dialog.getByRole('button', { name: 'Добавить доход' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('status')).toContainText('Доход «Зарплата» добавлен.');
      const incomeList = page.getByTestId('income-list');
      await expect(incomeList).toContainText('Зарплата');
      await expect(incomeList).toContainText('Это прогноз');

      const afterIncome = await getJson<Dashboard>(page, `${base}/dashboard`);
      expect(afterIncome.cashMinor).toBe(before.cashMinor);
      const journalAfter = await getJson<ItemList>(page, `${base}/transactions?limit=100`);
      expect(journalAfter.items).toHaveLength(0);
    });
  });
}

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
  const email = `v2-plans-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
}
