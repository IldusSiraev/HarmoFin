import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

// Family access stage B, ownership matrix: an EDITOR member sees the whole
// budget, funds anybody's envelope from their own income, and edits only their
// own objects. The creator «Ильдар» pours 10 000 of his income into the
// envelope of the invited member «Алия»; her envelope stays read-only for him
// (owner notice, no edit actions), the history names him as the assignment
// author, and her expense form offers only her own accounts.
test('a family member funds the spouse envelope but cannot edit it', async ({ browser }) => {
  // Three real pages, two Argon2id registrations and an invite round trip.
  test.setTimeout(180_000);

  const creator = await browser.newContext();
  const creatorPage = await creator.newPage();
  const member = await browser.newContext();
  const memberPage = await member.newPage();

  const creatorEmail = `e2e-own-creator-${Date.now()}@harmofin.test`;
  const memberEmail = `e2e-own-member-${Date.now()}@harmofin.test`;

  // 1. Creator: name, own account and an income category.
  await registerAccount(creatorPage, creatorEmail);
  await setDisplayName(creatorPage, 'Ильдар');
  await createAccountUi(creatorPage, 'Карта Ильдара', '20 000,00');
  await createCategoryUi(creatorPage, 'Зарплата', 'Доход');

  // 2. Invite an EDITOR (the dialog's default role) and register her.
  await creatorPage.goto('/app/settings/family');
  await waitForHydration(creatorPage);
  await creatorPage.getByRole('button', { name: 'Пригласить' }).click();
  const inviteDialog = creatorPage.getByRole('dialog', { name: 'Пригласить в семью' });
  await expect(inviteDialog).toBeVisible();
  await inviteDialog.getByLabel('Email').fill(memberEmail);
  await inviteDialog.getByRole('button', { name: 'Пригласить' }).click();
  const inviteUrl = await inviteDialog.getByLabel('Ссылка-приглашение').inputValue();
  expect(inviteUrl).toContain('/invite');

  await memberPage.goto(inviteUrl);
  await waitForHydration(memberPage);
  await expect(memberPage.getByText(/приглашает вас в семью/)).toBeVisible();
  await memberPage.getByRole('link', { name: 'Создать аккаунт' }).click();
  await waitForHydration(memberPage);
  await memberPage.getByLabel('Email').fill(memberEmail);
  await memberPage.getByLabel('Пароль').fill(password);
  await memberPage.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await memberPage.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await memberPage.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(memberPage).toHaveURL(/\/invite\?welcome=1$/);
  await waitForHydration(memberPage);
  await memberPage.getByLabel('Ваше имя').fill('Алия');
  await memberPage.getByRole('button', { name: 'Продолжить' }).click();
  await expect(memberPage).toHaveURL(/\/app$/);

  // 3. Member's own objects: her account and her envelope.
  await createAccountUi(memberPage, 'Карта Алии', '1 000,00');
  await memberPage.goto('/app/envelopes');
  await waitForHydration(memberPage);
  await memberPage.getByRole('button', { name: 'Создать конверт' }).first().click();
  const envelopeForm = memberPage.getByRole('dialog', { name: 'Новый конверт' });
  await expect(envelopeForm).toBeVisible();
  await envelopeForm.getByLabel('Название конверта').fill('Расходы на детей');
  await envelopeForm.getByRole('combobox', { name: 'Область действия' }).click();
  await memberPage.getByRole('option', { name: 'Свой конверт' }).click();
  await envelopeForm.getByRole('button', { name: 'Сохранить конверт' }).click();
  const envelopeRow = memberPage
    .locator('[data-testid^="envelope-row-"]')
    .filter({ hasText: 'Расходы на детей' });
  await expect(envelopeRow).toBeVisible();
  const envelopeTestId = await envelopeRow.getAttribute('data-testid');
  const envelopeId = (envelopeTestId ?? '').replace('envelope-row-', '');
  if (envelopeId === '') throw new Error('Envelope row lost its data-testid');

  // 4. Creator funds her envelope from his income through the offer sheet.
  await creatorPage.goto('/app/operations');
  await waitForHydration(creatorPage);
  const addTrigger = creatorPage
    .getByRole('complementary', { name: 'Основная навигация' })
    .getByTestId('add-menu-trigger');
  await expect(addTrigger).toBeVisible();
  await addTrigger.click();
  await creatorPage.getByTestId('operation-type-income').click();
  await fillOperationDate(creatorPage);
  await creatorPage.getByLabel('Сумма').fill('50 000,00');
  await selectPill(creatorPage, 'Счёт', 'Карта Ильдара');
  await selectPill(creatorPage, 'Категория', 'Зарплата');
  await creatorPage.getByTestId('entry-submit').click();
  await expect(creatorPage.getByTestId('toast-stack')).toContainText('Операция сохранена');

  const offer = creatorPage.getByRole('dialog', { name: 'Распределить деньги' });
  await expect(offer).toBeVisible();
  await expect(offer.getByTestId('funding-source')).toHaveText(/^50\s000,00/);
  // The foreign envelope is offered with its owner in the caption.
  await expect(offer.getByTestId(`funding-line-owner-${envelopeId}`)).toContainText('Алия');
  const line = offer.getByTestId(`funding-amount-${envelopeId}`);
  await line.fill('10000');
  await line.press('Enter');
  await expect(offer.getByTestId('funding-remaining')).toContainText(/^40\s000,00/);
  await expect(offer.getByTestId('funding-confirm')).toBeEnabled();
  await offer.getByTestId('funding-confirm').click();
  await expect(offer).toBeHidden();

  // 5. The creator opens her envelope: read-only for him, he is in the history.
  await creatorPage.goto('/app/envelopes');
  await waitForHydration(creatorPage);
  await creatorPage.getByTestId(`envelope-row-${envelopeId}`).click();
  const dialog = creatorPage.getByRole('dialog', { name: 'Расходы на детей' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('plan-dialog-owner-notice')).toContainText(
    'Принадлежит участнику «Алия»',
  );
  await expect(dialog.getByTestId('plan-dialog-edit')).toHaveCount(0);
  await expect(dialog.getByTestId('plan-dialog-reassign')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Изменить', exact: true })).toHaveCount(0);
  const historyEntry = dialog
    .locator('.plan-dialog__kind-title')
    .filter({ hasText: 'Ильдар' })
    .first();
  // The same money as the sheet showed it: historyAmountText renders the
  // sign plus formatMinorUnits, so «+10 000,00 ₽» with the locale group space.
  await expect(historyEntry).toContainText(/\+10\s000,00/);

  // 6. The owner sees her own controls, and her expense form lists only her
  // accounts: money leaves through the owner's accounts only.
  await memberPage.goto('/app/envelopes');
  await waitForHydration(memberPage);
  await memberPage.getByTestId(`envelope-row-${envelopeId}`).click();
  const ownDialog = memberPage.getByRole('dialog', { name: 'Расходы на детей' });
  await expect(ownDialog).toBeVisible();
  await expect(ownDialog.getByTestId('plan-dialog-owner-notice')).toHaveCount(0);
  await expect(ownDialog.getByTestId('plan-dialog-edit')).toBeVisible();
  // History is readable for her as a member: the allocation is there too,
  // with the same amount and the creator named as its author.
  const herHistoryEntry = ownDialog
    .locator('.plan-dialog__kind-title')
    .filter({ hasText: 'Ильдар' })
    .first();
  await expect(herHistoryEntry).toContainText(/\+10\s000,00/);
  await ownDialog.getByRole('button', { name: 'Закрыть' }).click();

  await memberPage.goto('/app/operations');
  await waitForHydration(memberPage);
  await memberPage.getByRole('main').getByRole('button', { name: 'Добавить операцию' }).click();
  await memberPage.getByTestId('operation-type-expense').click();
  const accountGroup = memberPage.getByRole('radiogroup', { name: 'Счёт' });
  await expect(accountGroup.getByRole('radio', { name: 'Карта Алии' })).toBeVisible();
  await expect(accountGroup.getByRole('radio', { name: 'Карта Ильдара' })).toHaveCount(0);
  // The envelope picker of the expense form stays on her editable envelopes:
  await expect(
    memberPage.getByRole('radiogroup', { name: 'Конверт' }).getByRole('radio', {
      name: 'Расходы на детей',
    }),
  ).toBeVisible();

  await creator.close();
  await member.close();
});

async function registerAccount(page: Page, email: string): Promise<void> {
  await page.goto('/register');
  await waitForHydration(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
}

async function setDisplayName(page: Page, name: string): Promise<void> {
  await page.goto('/app/settings/family');
  await waitForHydration(page);
  await page.getByRole('textbox', { name: 'Ваше имя' }).fill(name);
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('heading', { name: 'Укажите ваше имя' })).toBeHidden();
}

async function createAccountUi(page: Page, name: string, balance: string): Promise<void> {
  // Yesterday keeps the accounting start safely in the past for any time zone.
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const digits = `${String(day.getDate()).padStart(2, '0')}${String(day.getMonth() + 1).padStart(2, '0')}${day.getFullYear()}`;
  await page.goto('/app/accounts');
  await waitForHydration(page);
  await page.getByRole('button', { name: 'Создать счёт' }).first().click();
  await page.getByLabel('Название счёта').fill(name);
  await page.getByLabel('Начальный баланс').fill(balance);
  await page.getByLabel('Дата начала учёта').pressSequentially(digits);
  await page.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(page.getByTestId('toast-stack')).toContainText('Счёт создан');
}

async function createCategoryUi(page: Page, name: string, type: string): Promise<void> {
  // The categories page has no hydration marker, so retry until the dialog opens.
  await page.goto('/app/categories');
  const categoryName = page.getByLabel('Название категории');
  await expect(async () => {
    await page.getByRole('button', { name: 'Создать категорию' }).first().click();
    await expect(categoryName).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await categoryName.fill(name);
  await page.getByRole('combobox', { name: 'Тип категории' }).click();
  await page.getByRole('option', { name: type }).click();
  await page.getByRole('button', { name: 'Сохранить категорию' }).click();
  await expect(page.getByTestId('toast-stack')).toContainText('Категория создана');
}

async function fillOperationDate(page: Page): Promise<void> {
  const now = new Date();
  const digits = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;
  const date = page.getByLabel('Дата');
  await date.pressSequentially(digits);
  // Leaving the field closes the date picker popup, which otherwise covers the pills.
  await date.press('Tab');
}

async function selectPill(page: Page, group: string, option: string): Promise<void> {
  await page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option }).click();
}
