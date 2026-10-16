import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiMutate } from './api-mutate';
import { apiOrigin, apiV1 } from './env';
import { createPastLeftover, type PastLeftover } from './fixtures/v2-period-fixture';

// Envelope Plan v2.2, M06c: money left from a previous period needs an explicit
// decision, and the safe "Можно потратить" number protects the mandatory need.
// The only non-UI/API step is the CI-database fixture (a past period with an
// OPENING assignment); see fixtures/v2-period-fixture.ts. Mutating API calls
// below are marked SETUP or "user action via API". Amounts are synthetic.

const password = 'e2e-password-10';
const API_V2 = `${apiOrigin}/api/v2`;

interface Dashboard {
  period: { start: string; end: string; periodId: string | null };
  spendable: { state: string; amountMinor: string | null };
  cashMinor: string;
  currentBalanceMinor: string;
  mandatoryBalanceMinor: string;
  mandatoryDueMinor: string;
  mandatoryGapMinor: string;
  freeToAssignMinor: string;
  protectedAssignments: Array<{
    envelopeId: string;
    periodId: string | null;
    balanceMinor: string;
  }>;
  warnings: Array<{ code: string; balanceMinor: string | null }>;
}
interface Named {
  id: string;
  name: string;
}

for (const [label, viewport, theme] of [
  ['desktop 1280px, light theme', { width: 1280, height: 800 }, 'light'],
  ['mobile 390px, dark theme', { width: 390, height: 844 }, 'dark'],
] as const) {
  test.describe(label, () => {
    test.use({ viewport, colorScheme: theme });

    test('leftover of the previous period waits for a decision, then the safe number shows the mandatory gap', async ({
      page,
    }) => {
      test.setTimeout(240_000);
      let fixture: PastLeftover | null = null;
      await page.addInitScript(
        (value) => window.localStorage.setItem('harmofin-theme', value),
        theme,
      );
      try {
        await registerAndReachApp(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const me = await getJson<{
          workspaces: Array<{ budgets: Array<{ id: string; planModelVersion: number }> }>;
        }>(page, `${apiV1}/me`);
        const budget = me.workspaces[0]?.budgets[0];
        if (!budget) throw new Error('Missing budget');
        expect(budget.planModelVersion).toBe(2);
        const base = `${API_V2}/budgets/${budget.id}`;
        const settings = await getJson<{ timezone?: string }>(
          page,
          `${apiV1}/budgets/${budget.id}`,
        );
        const today = isoDate(settings.timezone ?? 'Europe/Moscow');

        // SETUP (API): template with a 65 000 target for both periods and two
        // mandatory plans (40 000 + 5 000 = 45 000 due today).
        const preview = await getJson<{ previewHash: string }>(
          page,
          `${base}/reference-template/preview`,
        );
        const template = await mutate<{ created: { categories: Named[] } }>(
          page,
          `${base}/reference-template/apply`,
          {
            previewHash: preview.previewHash,
            periods: [
              { role: 'FIRST', action: 'CREATE', target: '65000' },
              { role: 'SECOND', action: 'CREATE', target: '65000' },
            ],
            mandatory: { action: 'CREATE' },
            savings: [],
          },
        );
        const categoryId = (name: string): string => {
          const found = template.created.categories.find((item) => item.name === name);
          if (!found) throw new Error(`Template category "${name}" is missing`);
          return found.id;
        };
        for (const [name, amount] of [
          ['Аренда', '40000.00'],
          ['Детский сад', '5000.00'],
        ] as const) {
          await mutate(page, `${base}/obligations/plans`, {
            name,
            amount,
            scheduledOn: today,
            categoryId: categoryId(name),
            recurrence: 'ONE_TIME',
          });
        }
        const mandatory = (await getJson<{ items: Named[] }>(page, `${base}/envelopes`)).items.find(
          (item) => item.name === 'Обязательные',
        );
        if (!mandatory) throw new Error('Envelope "Обязательные" is missing');

        // Account with 100 000; no assignment dialog before the first assignment.
        await createAccount(page, 'Основная карта', '100 000,00');
        await expect(page.getByTestId('toast-stack')).toContainText('Счёт создан');
        await expect(page.getByRole('dialog', { name: 'Назначить деньги' })).toHaveCount(0);
        const before = await getJson<Dashboard>(page, `${base}/dashboard`);
        expect(before.cashMinor).toBe('10000000');
        expect(before.freeToAssignMinor).toBe('10000000');
        if (!before.period.periodId) throw new Error('No current period row after template');

        // FIXTURE (CI database only): a past period with 12 000 left over.
        fixture = await createPastLeftover({
          budgetId: budget.id,
          currentPeriodId: before.period.periodId,
          currentStart: before.period.start,
          effectiveOn: today,
          amountMinor: 1_200_000n,
          freeToAssignMinor: BigInt(before.freeToAssignMinor),
        });
        const withLeftover = await getJson<Dashboard>(page, `${base}/dashboard`);
        expect(withLeftover.warnings.map((item) => item.code)).toContain('PERIOD_LEFTOVER');
        expect(withLeftover.cashMinor).toBe('10000000');

        // 1. The decision card shows the leftover; "Оставить пока" sends nothing.
        await page.goto('/app');
        await dashboardReady(page);
        const card = page.getByTestId('period-decision-card');
        const row = card.getByTestId('leftover-row');
        await expect(row).toContainText('Остаток прошлого периода');
        await expect(row).toContainText(/12\s000,00/);
        const writes: string[] = [];
        page.on('request', (request) => {
          if (request.method() !== 'GET' && request.url().includes('/api/')) {
            writes.push(`${request.method()} ${request.url()}`);
          }
        });
        await openLeftoverMenu(row);
        await page.getByRole('menuitem', { name: 'Оставить пока' }).click();
        await expect(row).toBeHidden();
        expect(writes).toEqual([]);
        const kept = await getJson<Dashboard>(page, `${base}/dashboard`);
        expect(kept.warnings.map((item) => item.code)).toContain('PERIOD_LEFTOVER');

        // The server still holds the leftover, so a reload shows it again.
        await page.reload();
        await dashboardReady(page);
        await expect(row).toBeVisible();

        // 2. Known gap (S02): "В следующий период" is disabled in the UI.
        await openLeftoverMenu(row);
        await expect(page.getByRole('menuitem', { name: /В следующий период/ })).toHaveAttribute(
          'aria-disabled',
          'true',
        );
        await page.getByRole('menuitem', { name: 'Вернуть в свободные' }).click();
        const amount = page.getByTestId('leftover-amount');
        await expect(amount).toHaveValue('12000.00');
        await amount.fill('abc');
        await amount.press('Enter');
        await expect(page.getByTestId('leftover-amount-error')).toContainText(
          'Введите сумму числом',
        );
        await amount.fill('12000.00');
        await tabTo(page, page.getByTestId('leftover-confirm'));
        await expectVisibleFocus(page.getByTestId('leftover-confirm'));
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('leftover-amount')).toBeHidden();
        await expect(row).toBeHidden();

        const moved = await getJson<Dashboard>(page, `${base}/dashboard`);
        expect(moved.warnings.map((item) => item.code)).not.toContain('PERIOD_LEFTOVER');
        expect(moved.protectedAssignments).toHaveLength(0);
        expect(moved.cashMinor).toBe('10000000');
        expect(moved.freeToAssignMinor).toBe('10000000');

        // 3. Safe number: accept the period plan in the UI, then give the
        // current envelope 65 000 and "Обязательные" 35 000 from free money
        // (user action via API: the UI has no period-aware free assignment).
        await page.reload();
        await dashboardReady(page);
        // While the onboarding checklist is expanded it hosts the plan decision.
        await page
          .locator('[data-testid="target-confirm"], [data-testid="onboarding-target-confirm"]')
          .first()
          .click();
        await expect(page.getByTestId('target-row')).toBeHidden();
        await mutate(page, `${base}/assignments`, {
          sourceKind: 'FREE',
          envelopeId: fixture.envelopeId,
          periodId: before.period.periodId,
          amount: '65000.00',
        });
        await mutate(page, `${base}/assignments`, {
          sourceKind: 'FREE',
          envelopeId: mandatory.id,
          amount: '35000.00',
        });

        const safe = await getJson<Dashboard>(page, `${base}/dashboard`);
        expect(safe.cashMinor).toBe('10000000');
        expect(safe.currentBalanceMinor).toBe('6500000');
        expect(safe.mandatoryBalanceMinor).toBe('3500000');
        expect(safe.mandatoryDueMinor).toBe('4500000');
        expect(safe.spendable).toEqual({ state: 'READY', amountMinor: '5500000' });
        expect(safe.mandatoryGapMinor).toBe('1000000');

        await page.goto('/app');
        await dashboardReady(page);
        const hero = page.getByRole('region', { name: 'Можно потратить' });
        await expect(hero).toContainText(/55\s000,00/);
        await expect(hero).toContainText(/В конверте периода\s*65\s000,00/);
        await expect(hero).toContainText('Не хватает на обязательные');
        await expect(hero).toContainText(/10\s000,00/);
      } finally {
        await fixture?.cleanup();
      }
    });
  });
}

// Blocked by a missing API field (journal S02 and gate-06b; a separate additive
// API task for the owner): the dashboard DTO has no period.envelopeId /
// nextPeriodId, so "В следующий период" stays disabled and no honest UI or API
// path moves a leftover INTO the current period. Enable once the DTO has them.
test.fixme('leftover moved into the current period raises its funded amount without changing cash', async () => {
  // Plan once the field exists (same setup as the test above, up to the fixture):
  // 1. read dashboard: cashMinor, current funded (currentBalanceMinor), period.envelopeId;
  // 2. "В следующий период" -> confirm 12 000 in the sheet via the UI;
  // 3. GET dashboard: currentBalanceMinor up by exactly 1200000, cashMinor unchanged,
  //    no PERIOD_LEFTOVER warning, protectedAssignments without the past period.
});

// The dashboard page has no data-hydrated marker: it shows dashboard-loading
// until mounted and loaded, so wait for that and for the safe-number region.
async function dashboardReady(page: Page): Promise<void> {
  await expect(page.getByTestId('dashboard-loading')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Можно потратить' })).toBeVisible();
}

async function openLeftoverMenu(row: Locator): Promise<void> {
  await row.getByRole('button', { name: 'Действия с остатком прошлого периода' }).click();
}

// Reachability by keyboard: Tab until the target control owns the focus.
async function tabTo(page: Page, target: Locator, max = 40): Promise<void> {
  for (let step = 0; step < max; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

// A keyboard-focused control must show an outline or a ring.
async function expectVisibleFocus(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  const visible = await target.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    return outline || style.boxShadow !== 'none';
  });
  expect(visible).toBe(true);
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `${url} -> ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

// SETUP or user action via API (Origin, CSRF with one refresh retry, key).
async function mutate<T = unknown>(page: Page, url: string, body: unknown): Promise<T> {
  return apiMutate<T>(page, url, body);
}

// Today's date in the budget's own time zone (en-CA formats as YYYY-MM-DD).
function isoDate(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

async function registerAndReachApp(page: Page): Promise<void> {
  const email = `v2-period-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
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
