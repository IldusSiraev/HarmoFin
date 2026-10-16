import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';
import { apiOrigin, apiV1 } from './env';

// Envelope Plan v2.2, M06: a freshly registered owner lands on plan model 2,
// opens the same base-template preview from Settings and from the dashboard
// checklist, applies it once without savings, then adds an account with opening
// money, postpones the assignment offer ("Позже") and assigns from free money
// without any income. State is checked through the public API with the browser
// session; amounts are synthetic and the database is never read directly.

const password = 'e2e-password-10';
const API_V2 = `${apiOrigin}/api/v2`;

// Synthetic amounts (rubles typed by the user -> minor units seen on the wire).
const OPENING_TYPED = '7 000,00';
const OPENING_MINOR = '700000';
const ASSIGN_TYPED = '1500.00';
const ASSIGN_MINOR = '150000';
const FREE_AFTER_ASSIGN_MINOR = '550000';
const TARGET_FIRST = '3200';
const TARGET_SECOND = '2700';

interface MeResponse {
  workspaces: Array<{ budgets: Array<{ id: string; planModelVersion: number }> }>;
}
interface TemplatePreview {
  previewHash: string;
  cycle: { cycleStartDay: number; periodBoundaryOffset: number };
  categories: Array<{ templateKey: string; status: string }>;
  envelopes: Array<{ role: string; name: string; status: string }>;
}
interface TemplateApply {
  created: { categories: unknown[]; envelopes: unknown[] };
  adopted: unknown[];
  rules: Array<{ envelopeId: string; type: string }>;
}
interface EnvelopeList {
  items: Array<{ id: string; name: string; balanceMinor: string; archivedAt: string | null }>;
}
interface Dashboard {
  cashMinor: string;
  freeToAssignMinor: string;
  protectedAssignments: unknown[];
  accounts: Array<{ name: string; balanceMinor: string }>;
  onboarding: { categoriesSeeded: boolean; hasAccounts: boolean; needsOpeningAssignment: boolean };
}

for (const [label, viewport] of [
  ['desktop 1280px', { width: 1280, height: 800 }],
  ['mobile 390px', { width: 390, height: 844 }],
] as const) {
  test.describe(label, () => {
    test.use({ viewport });

    test('new v2 budget: one template preview from both entries, no duplicates, postponed opening money, assign from free', async ({
      page,
    }) => {
      test.setTimeout(180_000);

      // 1. Registration gives a plan model 2 budget with nothing created yet.
      await registerAndReachApp(page);
      const budgetId = await budgetIdOf(page);
      const initial = await getJson<TemplatePreview>(
        page,
        `${API_V2}/budgets/${budgetId}/reference-template/preview`,
      );
      expect(initial.categories.length).toBeGreaterThan(0);
      expect(initial.categories.every((item) => item.status === 'MISSING')).toBe(true);
      expect(initial.envelopes.every((item) => item.status === 'MISSING')).toBe(true);
      expect(
        (await getJson<EnvelopeList>(page, `${API_V2}/budgets/${budgetId}/envelopes`)).items,
      ).toHaveLength(0);

      // 2. Entry one: Settings.
      await page.goto('/app/settings');
      const fromSettings = await openTemplateSheet(page, '[data-action="initialize-template"]');
      const dialog = templateDialog(page);
      await expect(dialog.getByText('Укажу позже').first()).toBeVisible();
      // Cycle fields default to the budget's current settings; hints open by click and Esc
      // closes only the hint, not the dialog.
      await expect(dialog.getByTestId('template-cycle-start')).toHaveValue(
        String(fromSettings.cycle.cycleStartDay),
      );
      await expect(dialog.getByTestId('template-cycle-length')).toHaveValue(
        String(fromSettings.cycle.periodBoundaryOffset),
      );
      await dialog.getByRole('button', { name: 'Что такое финансовый цикл' }).click();
      await expect(dialog.getByRole('tooltip')).toContainText('от зарплаты до зарплаты');
      await page.keyboard.press('Escape');
      await expect(dialog.getByRole('tooltip')).toHaveCount(0);
      await expect(dialog).toBeVisible();
      const settingsView = await previewText(dialog);
      await dialog.getByTestId('template-cancel').click();
      await expect(dialog).toBeHidden();

      // 3. Entry two: the dashboard checklist shows the very same preview.
      await page.goto('/app');
      await expect(page.getByTestId('onboarding-checklist')).toBeVisible();
      await expect(page.getByTestId('onboarding-step')).toHaveCount(5);
      const fromChecklist = await openTemplateSheet(
        page,
        '[data-action="onboarding-initialize-template"]',
      );
      expect(fromChecklist.previewHash).toBe(fromSettings.previewHash);
      expect(await previewText(dialog)).toBe(settingsView);

      // 4. Invalid amount: Russian field error, focus returns to the field.
      const firstTarget = dialog.getByTestId('template-target-FIRST');
      const secondTarget = dialog.getByTestId('template-target-SECOND');
      await firstTarget.fill('abc');
      await tabTo(page, dialog.getByTestId('template-apply'));
      await page.keyboard.press('Enter');
      const fieldError = dialog.getByTestId('template-error-FIRST');
      await expect(fieldError).toContainText('Введите сумму больше нуля');
      await expect(firstTarget).toHaveAttribute('aria-invalid', 'true');
      await expect(firstTarget).toBeFocused();

      // 5. Different targets for the two periods, no savings, apply by keyboard.
      await firstTarget.fill(TARGET_FIRST);
      await secondTarget.fill(TARGET_SECOND);
      await expect(fieldError).toHaveCount(0);
      await expect(dialog.locator('[data-testid^="template-savings-"]:checked')).toHaveCount(0);
      await tabTo(page, dialog.getByTestId('template-apply'));
      const applyRequest = page.waitForRequest(isApplyRequest);
      const applyResponse = page.waitForResponse(isApplyResponse);
      await page.keyboard.press('Enter');
      const sent = (await applyRequest).postDataJSON() as {
        periods: Array<{ role: string; target?: string }>;
        savings: unknown[];
      };
      expect(sent.savings).toEqual([]);
      expect(sent.periods.find((item) => item.role === 'FIRST')?.target).toBe(TARGET_FIRST);
      expect(sent.periods.find((item) => item.role === 'SECOND')?.target).toBe(TARGET_SECOND);
      const applied = await applyResponse;
      expect(applied.status()).toBe(200);
      const first = (await applied.json()) as TemplateApply;
      expect(first.created.envelopes).toHaveLength(3);
      expect(first.rules.filter((rule) => rule.type === 'FIXED_PER_PERIOD')).toHaveLength(2);
      await expect(dialog).toBeHidden();

      const afterFirst = await snapshot(page, budgetId);
      expect(afterFirst.envelopeNames).toEqual(
        ['Обязательные', 'Первый период', 'Второй период'].sort(),
      );
      expect(afterFirst.categoryCount).toBe(initial.categories.length);
      expect(afterFirst.preview.categories.every((item) => item.status === 'EXISTING')).toBe(true);
      expect(afterFirst.dashboard.onboarding.categoriesSeeded).toBe(true);

      // 6. Repeat from Settings: everything exists, nothing is created twice.
      await page.goto('/app/settings');
      await openTemplateSheet(page, '[data-action="initialize-template"]');
      await expect(dialog.getByTestId('template-categories-summary')).toContainText(
        'Будет создано: 0',
      );
      const repeatResponse = page.waitForResponse(isApplyResponse);
      await tabTo(page, dialog.getByTestId('template-apply'));
      await page.keyboard.press('Enter');
      const repeated = (await (await repeatResponse).json()) as TemplateApply;
      expect(repeated.created.envelopes).toHaveLength(0);
      expect(repeated.created.categories).toHaveLength(0);
      await expect(dialog).toBeHidden();
      await expect(page.getByText('Базовый шаблон настроен.')).toBeVisible();
      const afterRepeat = await snapshot(page, budgetId);
      expect(afterRepeat.envelopeNames).toEqual(afterFirst.envelopeNames);
      expect(afterRepeat.categoryCount).toBe(afterFirst.categoryCount);

      // 7. Account with opening money, no income: no assignment dialog during the
      // initial setup; the toast points to the checklist step instead.
      await createAccount(page, 'Основная карта', OPENING_TYPED);
      await expect(page.getByTestId('toast-stack')).toContainText(
        'Распределить деньги по конвертам можно на шаге «Назначить имеющиеся деньги» на главной.',
      );
      await expect(page.getByRole('dialog', { name: 'Назначить деньги' })).toHaveCount(0);

      const postponed = await snapshot(page, budgetId);
      expect(postponed.dashboard.cashMinor).toBe(OPENING_MINOR);
      expect(postponed.dashboard.freeToAssignMinor).toBe(OPENING_MINOR);
      expect(postponed.dashboard.protectedAssignments).toHaveLength(0);
      expect(postponed.dashboard.accounts.map((item) => item.name)).toContain('Основная карта');
      expect(postponed.dashboard.onboarding.needsOpeningAssignment).toBe(true);

      await page.goto('/app');
      await expect(page.getByTestId('onboarding-step')).toHaveCount(5);
      expect(
        await page
          .getByTestId('onboarding-step')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-step'))),
      ).toEqual([
        'categoriesSeeded',
        'hasAccounts',
        'hasMandatoryPlans',
        'periodSetup',
        'openingAssignment',
      ]);
      await page.getByTestId('onboarding-mandatory-decline').click();
      await expect(
        page.locator('[data-step="hasMandatoryPlans"] [data-testid="onboarding-step-done"]'),
      ).toBeVisible();
      await expect(page.locator('[data-action="onboarding-assign-money"]')).toBeVisible();

      // Confirming the template's proposed period target does not move money;
      // it only unblocks the "Можно потратить" calculation for the period.
      const confirmTargetResponse = page.waitForResponse(
        (response) =>
          /\/periods\/[^/]+\/confirm-target$/.test(response.url()) &&
          response.request().method() === 'POST',
      );
      await page.getByTestId('onboarding-target-confirm').click();
      expect((await confirmTargetResponse).status()).toBe(200);
      await expect(
        page.locator('[data-step="periodSetup"] [data-testid="onboarding-step-done"]'),
      ).toBeVisible();

      await page.locator('[data-action="toggle-breakdown"]').click();
      await expect(page.getByText('Свободно для назначения', { exact: true })).toBeVisible();

      // 8. Assign from free money without any income.
      const mandatory = afterRepeat.envelopes.find((item) => item.name === 'Обязательные');
      if (!mandatory) throw new Error('Template envelope "Обязательные" is missing');
      await page.goto('/app/envelopes');
      await page.getByTestId(`row-actions-${mandatory.id}`).click();
      await page.getByTestId('row-reassign').click();
      const panel = page.getByTestId('move-panel');
      await expect(panel).toBeVisible();
      await panel.getByTestId('move-direction-free-envelope').check();
      await panel.getByTestId('move-amount').fill('abc');
      await page.getByTestId('move-confirm').click();
      await expect(panel.getByTestId('move-amount-error')).toContainText('Введите сумму числом');
      await panel.getByTestId('move-amount').fill(ASSIGN_TYPED);
      const assignResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/budgets/${budgetId}/assignments`) &&
          response.request().method() === 'POST',
      );
      await page.getByTestId('move-confirm').click();
      expect((await assignResponse).status()).toBe(201);
      await expect(panel).toBeHidden();

      const assigned = await snapshot(page, budgetId);
      expect(assigned.envelopes.find((item) => item.id === mandatory.id)?.balanceMinor).toBe(
        ASSIGN_MINOR,
      );
      expect(assigned.dashboard.cashMinor).toBe(OPENING_MINOR);
      expect(assigned.dashboard.freeToAssignMinor).toBe(FREE_AFTER_ASSIGN_MINOR);
      expect(assigned.envelopeNames).toEqual(afterRepeat.envelopeNames);

      // All five steps are done now (categories, account, mandatory declined,
      // period confirmed, assignment exists): the checklist disappears.
      await page.goto('/app');
      await expect(page.getByTestId('onboarding-checklist')).toHaveCount(0);
    });
  });
}

function isApplyRequest(request: Request): boolean {
  return request.url().includes('/reference-template/apply') && request.method() === 'POST';
}

function isApplyResponse(response: Response): boolean {
  return isApplyRequest(response.request());
}

function templateDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Базовый шаблон бюджета' });
}

async function openTemplateSheet(page: Page, trigger: string): Promise<TemplatePreview> {
  await expect(page.locator(trigger)).toBeVisible();
  const loaded = page.waitForResponse(
    (response) =>
      response.url().includes('/reference-template/preview') &&
      response.request().method() === 'GET',
  );
  await page.locator(trigger).click();
  const body = (await (await loaded).json()) as TemplatePreview;
  await expect(templateDialog(page)).toBeVisible();
  await expect(templateDialog(page).getByTestId('template-apply')).toBeEnabled();
  return body;
}

async function previewText(dialog: Locator): Promise<string> {
  const parts: string[] = [];
  for (const testId of [
    'template-categories-summary',
    'template-row-FIRST',
    'template-row-SECOND',
    'template-row-MANDATORY',
  ]) {
    parts.push((await dialog.getByTestId(testId).innerText()).replace(/\s+/g, ' ').trim());
  }
  return parts.join(' | ');
}

// Reachability by keyboard: Tab until the target control owns the focus.
async function tabTo(page: Page, target: Locator, max = 40): Promise<void> {
  for (let step = 0; step < max; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function snapshot(page: Page, budgetId: string) {
  const base = `${API_V2}/budgets/${budgetId}`;
  const envelopes = (await getJson<EnvelopeList>(page, `${base}/envelopes`)).items.filter(
    (item) => item.archivedAt === null,
  );
  const preview = await getJson<TemplatePreview>(page, `${base}/reference-template/preview`);
  const dashboard = await getJson<Dashboard>(page, `${base}/dashboard`);
  return {
    envelopes,
    envelopeNames: envelopes.map((item) => item.name).sort(),
    categoryCount: preview.categories.filter((item) => item.status === 'EXISTING').length,
    preview,
    dashboard,
  };
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
  const email = `v2-onboarding-${Date.now()}-${Math.random().toString(16).slice(2)}@harmofin.test`;
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
