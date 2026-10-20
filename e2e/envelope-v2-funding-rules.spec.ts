import { expect, test, type Page } from '@playwright/test';
import { apiMutate } from './api-mutate';
import { apiOrigin, apiV1 } from './env';

// Funding rules page: the queue is reordered with the buttons, one rule type is
// changed, everything is saved with one button; the API returns the new order
// and the envelope details show the rule and its queue number. Setup goes
// through the API and is marked "SETUP". Amounts are synthetic.

const password = 'e2e-password-10';
const API_V2 = `${apiOrigin}/api/v2`;

interface MeResponse {
  workspaces: Array<{ budgets: Array<{ id: string; planModelVersion: number }> }>;
}
interface EnvelopeList {
  items: Array<{ id: string; name: string; envelopeType: string }>;
}
interface RuleList {
  items: Array<{
    envelopeId: string;
    type: string;
    priority: number;
    fixedAmountMinor: string | null;
  }>;
}

test('funding rules page: reorder, change a rule and save once', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });

  await registerAndReachApp(page);
  const budgetId = await budgetIdOf(page);
  const base = `${API_V2}/budgets/${budgetId}`;

  // SETUP (API): template envelopes, then a known queue of two envelopes.
  const preview = await getJson<{ previewHash: string }>(
    page,
    `${base}/reference-template/preview`,
  );
  await apiMutate(page, `${base}/reference-template/apply`, {
    previewHash: preview.previewHash,
    periods: [
      { role: 'FIRST', action: 'CREATE' },
      { role: 'SECOND', action: 'CREATE' },
    ],
    mandatory: { action: 'CREATE' },
    savings: [],
  });
  const envelopes = (await getJson<EnvelopeList>(page, `${base}/envelopes`)).items;
  const candidates = envelopes.filter((item) => item.envelopeType !== 'MANDATORY_EXPENSES');
  expect(candidates.length).toBeGreaterThanOrEqual(2);
  const [first, second] = candidates as [EnvelopeList['items'][0], EnvelopeList['items'][0]];
  await apiMutate(
    page,
    `${base}/funding-rules`,
    {
      queue: [
        { envelopeId: first.id, type: 'PERCENT_OF_INCOME', percentBasisPoints: 1000 },
        { envelopeId: second.id, type: 'PERCENT_OF_INCOME', percentBasisPoints: 2000 },
      ],
      outside: envelopes
        .filter((item) => item.id !== first.id && item.id !== second.id)
        .map((item) => ({ envelopeId: item.id, type: 'MANUAL' })),
      incomeSuggestion: { enabled: false, sourceCategoryId: null, targetEnvelopeId: null },
    },
    'PUT',
  );

  // 1. From the envelopes page to the rules page.
  await page.goto('/app/envelopes');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole('link', { name: 'Задать правила' }).click();
  await expect(page).toHaveURL(/\/app\/envelopes\/rules$/);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  const queue = page.getByTestId('rules-queue');
  await expect(queue.locator('[data-queue-item]')).toHaveCount(2);

  // 2. Move the first envelope down and give it a fixed amount.
  await page.getByTestId(`rule-down-${first.id}`).click();
  await expect(page.getByTestId('rules-announce')).toContainText('позиция 2 из 2');
  await page.getByTestId(`rule-type-${first.id}`).getByRole('combobox').click();
  await page.getByRole('option', { name: 'Фиксированная цель на период' }).click();
  await page.getByTestId(`rule-fixed-${first.id}`).locator('input').fill('15000');
  await page.getByTestId('rules-save').click();
  await expect(page.getByText('Правила сохранены')).toBeVisible();
  await expect(page.getByTestId('rules-save')).toBeDisabled();

  // 3. The API returns the new order and rule.
  const rules = (await getJson<RuleList>(page, `${base}/funding-rules`)).items.filter(
    (item) => item.type !== 'MANUAL',
  );
  expect(rules.map((item) => item.envelopeId)).toEqual([second.id, first.id]);
  expect(rules[1]).toMatchObject({ type: 'FIXED_PER_PERIOD', fixedAmountMinor: '1500000' });

  // 4. The envelope details show the rule and its queue number.
  await page.getByTestId('rules-back').click();
  await expect(page).toHaveURL(/\/app\/envelopes$/);
  await page.getByTestId(`envelope-row-${first.id}`).click();
  await expect(page.getByTestId('plan-dialog-rule')).toContainText('№2 в очереди');
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
  const email = `v2-rules-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
}
