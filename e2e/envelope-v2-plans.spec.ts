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
interface TemplateApply {
  created: { categories: Array<{ id: string; name: string }> };
}
interface PlanCreated {
  occurrenceId: string | null;
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
      await expect(page.getByTestId('plans-list')).toContainText('Обязательных платежей пока нет.');
      await expect(page.getByTestId('plans-list')).toContainText(
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
      await expect(page.getByTestId('plans-list')).toContainText('Аренда');

      // 2. API: the plan exists, but no operation was created.
      const occurrences = await getJson<ItemList>(page, `${base}/obligations/occurrences`);
      expect(occurrences.items.some((item) => item.name === 'Аренда')).toBe(true);
      const journal = await getJson<ItemList>(page, `${base}/transactions?limit=100`);
      expect(journal.items).toHaveLength(0);
      const afterPayment = await getJson<Dashboard>(page, `${base}/dashboard`);
      expect(afterPayment.onboarding.hasMandatoryPlans).toBe(true);
      expect(afterPayment.cashMinor).toBe(before.cashMinor);

      // 3. Expected income through the same dialog (the list already holds a
      // payment, so the empty-state button is absent): it is a forecast only.
      await page.getByTestId('plan-add-obligation').click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('tab', { name: 'Доход' }).click();
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
      const incomeList = page.getByTestId('plans-list');
      await expect(incomeList).toContainText('Зарплата');
      await expect(incomeList).toContainText('Это прогноз');

      const afterIncome = await getJson<Dashboard>(page, `${base}/dashboard`);
      expect(afterIncome.cashMinor).toBe(before.cashMinor);
      const journalAfter = await getJson<ItemList>(page, `${base}/transactions?limit=100`);
      expect(journalAfter.items).toHaveLength(0);
    });

    test('calendar: day panel adds a plan on the selected date', async ({ page }) => {
      test.setTimeout(180_000);

      await registerAndReachApp(page);
      const budgetId = await budgetIdOf(page);
      const base = `${API_V2}/budgets/${budgetId}`;

      // SETUP (API): the base template gives expense categories.
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

      await page.goto('/app/plans');
      await expect(page.locator('[data-hydrated="true"]')).toBeVisible();

      // Today in the budget's own time zone (YYYY-MM-DD and DD.MM.YYYY).
      const iso = await budgetToday(page, budgetId);
      const today = { iso, typed: `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` };

      await page.getByTestId(`calendar-day-${today.iso}`).click();
      const panel = page.getByTestId('day-panel');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('На этот день пока ничего нет');

      await page.getByTestId('plan-add-for-day').click();
      const dialog = page.getByRole('dialog', { name: 'Создать план' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('#planScheduledOn-input')).toHaveValue(today.typed);

      await dialog.getByLabel('Сумма').fill('1500');
      await dialog.getByLabel('Название').fill('Интернет');
      await dialog
        .getByRole('radiogroup', { name: 'Категория' })
        .getByRole('radio')
        .first()
        .click();
      await dialog.getByRole('button', { name: 'Добавить платёж' }).click();
      await expect(dialog).toBeHidden();

      await expect(page.getByTestId(`calendar-dot-${today.iso}`)).toHaveAttribute(
        'data-dot',
        'upcoming',
      );
    });

    test('calendar: a month with a payment and an income shows them in dot, panel and KPI', async ({
      page,
    }) => {
      test.setTimeout(180_000);

      await registerAndReachApp(page);
      const budgetId = await budgetIdOf(page);
      const base = `${API_V2}/budgets/${budgetId}`;

      // SETUP (API): template categories, one payment plan and one income plan today.
      const preview = await getJson<TemplatePreview>(page, `${base}/reference-template/preview`);
      const template = await apiMutate<TemplateApply>(page, `${base}/reference-template/apply`, {
        previewHash: preview.previewHash,
        periods: [
          { role: 'FIRST', action: 'CREATE' },
          { role: 'SECOND', action: 'CREATE' },
        ],
        mandatory: { action: 'CREATE' },
        savings: [],
      });
      const categoryId = (name: string): string => {
        const found = template.created.categories.find((item) => item.name === name);
        if (!found) throw new Error(`Template category "${name}" is missing`);
        return found.id;
      };
      const today = await budgetToday(page, budgetId);
      const payment = await apiMutate<PlanCreated>(page, `${base}/obligations/plans`, {
        name: 'Аренда',
        amount: '45000.00',
        scheduledOn: today,
        categoryId: categoryId('Аренда'),
        recurrence: 'ONE_TIME',
      });
      const income = await apiMutate<PlanCreated>(page, `${base}/income-plans`, {
        name: 'Премия',
        amount: '100000.00',
        scheduledOn: today,
        categoryId: categoryId('Премия'),
        recurrence: 'ONE_TIME',
      });
      if (!payment.occurrenceId || !income.occurrenceId) {
        throw new Error('Plans did not create an occurrence');
      }

      await page.goto('/app/plans');
      await expect(page.locator('[data-hydrated="true"]')).toBeVisible();

      await expect(page.getByTestId(`calendar-dot-${today}`)).toHaveAttribute(
        'data-dot',
        'upcoming',
      );
      await page.getByTestId(`calendar-day-${today}`).click();
      const panel = page.getByTestId('day-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId(`day-item-${payment.occurrenceId}`)).toBeVisible();
      await expect(panel.getByTestId(`day-item-${income.occurrenceId}`)).toBeVisible();
      await expect(page.getByTestId('kpi-planned-income')).toContainText(/100\s000/);
      await expect(page.getByTestId('kpi-planned-expense')).toContainText(/45\s000/);
    });
  });
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `${url} -> ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

// Today's date in the budget's own time zone (en-CA formats as YYYY-MM-DD).
async function budgetToday(page: Page, budgetId: string): Promise<string> {
  const budget = await getJson<{ timezone?: string }>(page, `${apiV1}/budgets/${budgetId}`);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: budget.timezone ?? 'Europe/Moscow',
  }).format(new Date());
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
