import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiMutate } from './api-mutate';
import { apiOrigin, apiV1 } from './env';

// Envelope Plan v2.2, M06b: partial income assignment and partial mandatory
// payments on a fresh plan model 2 budget, in the dark theme and by keyboard.
//
// Setup (template categories/envelope and the two obligation plans) goes through
// the API because the web app has no v2 obligation-plan form yet; it is marked
// "SETUP" below. Every checked action (account, income, assignment, payments) is
// driven through the UI, and the results are read back with API GETs from actual
// amounts. Amounts are synthetic; the database is never read.

const password = 'e2e-password-10';
const API_V2 = `${apiOrigin}/api/v2`;

// Rubles typed by the user and the matching minor-unit strings on the wire.
const OPENING_TYPED = '20 000,00';
const INCOME_TYPED = '30 000,00';
const ASSIGNED_TYPED = '25000.00';
const RENT_PLAN = '40000.00';
const KINDERGARTEN_PLAN = '3000.00';

interface Item {
  id: string;
  name: string;
  status?: string;
  transactionType?: string;
  paidMinor?: string;
  unpaidMinor?: string;
  balanceMinor?: string;
  fundedMinor?: string;
  spentMinor?: string;
  amountMinor?: string;
  envelopeId?: string | null;
}
interface ItemList {
  items: Item[];
}
interface MeResponse {
  workspaces: Array<{ budgets: Array<{ id: string; planModelVersion: number }> }>;
}
interface TemplatePreview {
  previewHash: string;
}
interface TemplateApply {
  created: { categories: Array<{ id: string; name: string }> };
}
interface PlanCreated {
  occurrenceId: string | null;
}
interface Dashboard {
  cashMinor: string;
  freeToAssignMinor: string;
  protectedAssignments: unknown[];
}

test('v2: partial income assignment, rent in two parts and a smaller kindergarten payment (dark theme, keyboard)', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => window.localStorage.setItem('harmofin-theme', 'dark'));

  await registerAndReachApp(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const budgetId = await budgetIdOf(page);
  const base = `${API_V2}/budgets/${budgetId}`;

  // SETUP (API): base template gives the categories and the "Обязательные"
  // envelope; two mandatory plans are due today.
  const preview = await getJson<TemplatePreview>(page, `${base}/reference-template/preview`);
  const template = await mutate<TemplateApply>(page, `${base}/reference-template/apply`, {
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
  const budget = await getJson<{ timezone?: string }>(page, `${apiV1}/budgets/${budgetId}`);
  const today = isoDate(budget.timezone ?? 'Europe/Moscow');
  const rentPlan = await mutate<PlanCreated>(page, `${base}/obligations/plans`, {
    name: 'Аренда',
    amount: RENT_PLAN,
    scheduledOn: today,
    categoryId: categoryId('Аренда'),
    recurrence: 'ONE_TIME',
  });
  const kindergartenPlan = await mutate<PlanCreated>(page, `${base}/obligations/plans`, {
    name: 'Детский сад',
    amount: KINDERGARTEN_PLAN,
    scheduledOn: today,
    categoryId: categoryId('Детский сад'),
    recurrence: 'ONE_TIME',
  });
  const rentId = rentPlan.occurrenceId;
  const kindergartenId = kindergartenPlan.occurrenceId;
  if (!rentId || !kindergartenId) throw new Error('Plans did not create an occurrence');
  const mandatory = (await getJson<ItemList>(page, `${base}/envelopes`)).items.find(
    (item) => item.name === 'Обязательные',
  );
  if (!mandatory) throw new Error('Envelope "Обязательные" is missing');

  // 1. Account with opening money: the offer is postponed with Escape.
  await createAccount(page, 'Основная карта', OPENING_TYPED);
  const openingOffer = page.getByRole('dialog', { name: 'Назначить деньги' });
  await expect(openingOffer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(openingOffer).toBeHidden();
  const postponed = await getJson<Dashboard>(page, `${base}/dashboard`);
  expect(postponed.cashMinor).toBe('2000000');
  expect(postponed.freeToAssignMinor).toBe('2000000');
  expect(postponed.protectedAssignments).toHaveLength(0);

  // 2. Income smaller than the need (43 000 due, 30 000 received) through "+".
  await page.goto('/app');
  await expect(page.getByTestId('dashboard-loading')).toHaveCount(0);
  // The dashboard renders three triggers (sidebar, header, main); use the sidebar one.
  const addTrigger = page
    .getByRole('complementary', { name: 'Основная навигация' })
    .getByTestId('add-menu-trigger');
  await expect(addTrigger).toBeVisible();
  await addTrigger.click();
  await page.getByTestId('operation-type-income').click();
  await fillOperationDate(page);
  await page.getByLabel('Сумма').fill(INCOME_TYPED);
  await selectPill(page, 'Счёт', 'Основная карта');
  await selectPill(page, 'Категория', 'Премия');
  await page.getByTestId('entry-submit').click();
  await expect(page.getByTestId('toast-stack')).toContainText('Операция сохранена');

  // 3. The panel offers a part; assign only a part of the income, keep the rest free.
  const offer = page.getByRole('dialog', { name: 'Назначить деньги' });
  await expect(offer).toBeVisible();
  await expect(offer.getByTestId('funding-source')).toHaveText(/^30\s000,00/);
  // A mandatory current-slice line is keyed by the canonical lineId
  // `<envelopeId>||MANDATORY_CURRENT` (see `mandatoryLineId` in the API); the web
  // sheet renders the input as `funding-amount-<sanitized lineId>`
  // (see lineToken in FundingReviewSheet.vue).
  const mandatoryLineToken = `${mandatory.id}||MANDATORY_CURRENT`.replace(/[^A-Za-z0-9-]+/g, '-');
  const line = offer.getByTestId(`funding-amount-${mandatoryLineToken}`);
  await line.fill(ASSIGNED_TYPED);
  await line.press('Enter');
  await expect(offer.getByTestId('funding-remaining')).toContainText(/^5\s000,00/);
  // The shortfall is shown as a warning and never blocks the assignment.
  await expect(offer.getByTestId('funding-gap')).toBeVisible();
  const confirm = offer.getByTestId('funding-confirm');
  await expect(confirm).toBeEnabled();
  await tabTo(page, confirm);
  await page.keyboard.press('Enter');
  await expect(offer).toBeHidden();

  const funded = await getJson<Item>(page, `${base}/envelopes/${mandatory.id}`);
  expect(funded.fundedMinor).toBe('2500000');
  const afterFunding = await getJson<Dashboard>(page, `${base}/dashboard`);
  expect(afterFunding.cashMinor).toBe('5000000');
  expect(afterFunding.freeToAssignMinor).toBe('2500000');

  // 4. Rent in two parts; Escape closes a sheet without paying anything.
  await page.goto('/app/plans');
  const rentRow = page.getByTestId(`obligation-row-${rentId}`);
  await expect(rentRow).toBeVisible();
  const paySheet = page.getByRole('dialog', { name: 'Оплатить обязательство' });

  await page.getByTestId(`obligation-pay-${kindergartenId}`).click();
  await expect(paySheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(paySheet).toBeHidden();
  expect(await expenseAmounts(page, base)).toEqual([]);

  await page.getByTestId(`obligation-pay-${rentId}`).click();
  await expect(paySheet.getByTestId('pay-expected')).toContainText(/^40\s000,00/);
  await expect(paySheet.getByTestId('pay-will-pay-more')).toHaveCount(0);
  await paySheet.getByTestId('pay-amount').fill('35000');
  await expect(paySheet.getByText('Будет доплата')).toBeVisible();
  await paySheet.getByTestId('pay-will-pay-more').check();
  await selectPill(page, 'Счёт списания', 'Основная карта');
  await tabTo(page, paySheet.getByTestId('pay-submit'));
  await page.keyboard.press('Enter');
  await expect(paySheet).toBeHidden();
  await expect(rentRow).toContainText('Остаток');
  await expect(rentRow).toContainText(/Остаток\s*5\s000,00/);

  const rentOpen = await occurrence(page, base, rentId);
  expect(rentOpen.paidMinor).toBe('3500000');
  expect(rentOpen.unpaidMinor).toBe('500000');
  expect(['DUE', 'PENDING']).toContain(rentOpen.status);

  await page.getByTestId(`obligation-pay-${rentId}`).click();
  await paySheet.getByTestId('pay-amount').fill('5000');
  await selectPill(page, 'Счёт списания', 'Основная карта');
  await paySheet.getByTestId('pay-submit').click();
  await expect(paySheet).toBeHidden();
  // Completed rows leave the «Ближайшие» list; they stay visible in «Все».
  await page.getByTestId('list-mode-all').click();
  await expect(rentRow).toContainText('Выполнено');

  // 5. Kindergarten: 3 000 planned, 2 000 paid and closed, no made-up top-up.
  await page.getByTestId(`obligation-pay-${kindergartenId}`).click();
  await expect(paySheet.getByTestId('pay-expected')).toContainText(/^3\s000,00/);
  await paySheet.getByTestId('pay-amount').fill('2000');
  await expect(paySheet.getByTestId('pay-will-pay-more')).not.toBeChecked();
  await selectPill(page, 'Счёт списания', 'Основная карта');
  await paySheet.getByTestId('pay-submit').click();
  await expect(paySheet).toBeHidden();
  const kindergartenRow = page.getByTestId(`obligation-row-${kindergartenId}`);
  await expect(kindergartenRow).toContainText('Выполнено');
  await expect(kindergartenRow).not.toContainText('Остаток');

  // 6. Actual amounts from the API: occurrences, the journal and the envelope.
  const rentDone = await occurrence(page, base, rentId);
  expect(rentDone.status).toBe('COMPLETED');
  expect(rentDone.paidMinor).toBe('4000000');
  const kindergartenDone = await occurrence(page, base, kindergartenId);
  expect(kindergartenDone.status).toBe('COMPLETED');
  expect(kindergartenDone.paidMinor).toBe('200000');
  expect(kindergartenDone.unpaidMinor).toBe('0');

  const journal = await getJson<ItemList>(page, `${base}/transactions?limit=100`);
  const expenses = journal.items.filter((item) => item.transactionType === 'EXPENSE');
  expect(expenses.map((item) => item.amountMinor).sort()).toEqual(['200000', '3500000', '500000']);
  expect(expenses.every((item) => item.envelopeId === mandatory.id)).toBe(true);
  expect(journal.items).toHaveLength(4); // three payments and the single income

  const after = await getJson<Item>(page, `${base}/envelopes/${mandatory.id}`);
  expect(after.fundedMinor).toBe('2500000');
  expect(after.spentMinor).toBe('4200000');
  expect(after.balanceMinor).toBe('-1700000');
  const dashboard = await getJson<Dashboard>(page, `${base}/dashboard`);
  expect(dashboard.cashMinor).toBe('800000');

  // The envelope list shows the separate "Обязательные" remainder as overspent.
  await page.goto('/app/envelopes');
  const envelopeRow = page.getByTestId(`envelope-row-${mandatory.id}`);
  await expect(envelopeRow).toContainText('Обязательные');
  await expect(envelopeRow).toContainText('Перерасход');
});

async function expenseAmounts(page: Page, base: string): Promise<string[]> {
  const journal = await getJson<ItemList>(page, `${base}/transactions?type=EXPENSE&limit=100`);
  return journal.items.map((item) => item.amountMinor ?? '').sort();
}

async function occurrence(page: Page, base: string, id: string): Promise<Item> {
  const list = await getJson<ItemList>(page, `${base}/obligations/occurrences`);
  const found = list.items.find((item) => item.id === id);
  if (!found) throw new Error('Occurrence is missing');
  return found;
}

// Reachability by keyboard: Tab until the target control owns the focus.
async function tabTo(page: Page, target: Locator, max = 40): Promise<void> {
  for (let step = 0; step < max; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `${url} -> ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

// SETUP only: a mutating API call (Origin, CSRF with one refresh retry, key).
async function mutate<T>(page: Page, url: string, body: unknown): Promise<T> {
  return apiMutate<T>(page, url, body);
}

async function budgetIdOf(page: Page): Promise<string> {
  const me = await getJson<MeResponse>(page, `${apiV1}/me`);
  const budget = me.workspaces[0]?.budgets[0];
  if (!budget) throw new Error('Missing budget');
  expect(budget.planModelVersion).toBe(2);
  return budget.id;
}

// Today's date in the budget's own time zone (en-CA formats as YYYY-MM-DD).
function isoDate(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

async function registerAndReachApp(page: Page): Promise<void> {
  const email = `v2-payments-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function createAccount(page: Page, name: string, balance: string): Promise<void> {
  // Yesterday keeps the accounting start safely in the past for any time zone.
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const digits = `${String(day.getDate()).padStart(2, '0')}${String(day.getMonth() + 1).padStart(2, '0')}${day.getFullYear()}`;
  await page.goto('/app/accounts');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill(name);
  await page.getByLabel('Начальный баланс').fill(balance);
  await page.getByLabel('Дата начала учёта').pressSequentially(digits);
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
}

async function fillOperationDate(page: Page): Promise<void> {
  const now = new Date();
  const digits = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;
  await page.getByLabel('Дата').pressSequentially(digits);
}

async function selectPill(page: Page, group: string, option: string): Promise<void> {
  await page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option }).click();
}
