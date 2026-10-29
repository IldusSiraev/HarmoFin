import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

test('creator invites a family member who records an expense', async ({ browser }) => {
  // Two real registrations plus the invited member's registration each pay
  // for real Argon2id hashing.
  test.setTimeout(90_000);

  const creator = await browser.newContext();
  const creatorPage = await creator.newPage();
  const member = await browser.newContext();
  const memberPage = await member.newPage();

  const creatorEmail = `e2e-family-creator-${Date.now()}@harmofin.test`;
  const memberEmail = `e2e-family-member-${Date.now()}@harmofin.test`;

  // 1. Register the creator and set a display name on the family page.
  await registerAccount(creatorPage, creatorEmail);

  await creatorPage.goto('/app/settings/family');
  await waitForHydration(creatorPage);
  // The card's own aria-labelledby heading («Укажите ваше имя») also matches
  // a substring label lookup, so target the textbox role.
  await creatorPage.getByRole('textbox', { name: 'Ваше имя' }).fill('Создатель');
  await creatorPage.getByRole('button', { name: 'Сохранить' }).click();
  // Once the name is saved the page drops the prompt card (and its transient
  // «Имя сохранено.» status) and unlocks inviting.
  await expect(creatorPage.getByRole('heading', { name: 'Укажите ваше имя' })).toBeHidden();
  await expect(creatorPage.getByRole('button', { name: 'Пригласить' })).toBeEnabled();

  // An account is needed before any operation (quick-add account list would
  // otherwise be empty), so the creator sets one up before inviting.
  await creatorPage.goto('/app/accounts');
  await waitForHydration(creatorPage);
  await creatorPage.getByRole('button', { name: 'Создать счёт' }).first().click();
  await creatorPage.getByLabel('Название счёта').fill('Основной счёт');
  await creatorPage.getByLabel('Начальный баланс').fill('10 000,00');
  await creatorPage.getByLabel('Дата начала учёта').pressSequentially('04092026');
  await creatorPage.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(creatorPage.getByTestId('toast-stack')).toContainText('Счёт создан');

  // A fresh workspace has no categories either, and the quick-add category
  // picker would be empty. The categories page has no hydration marker, so
  // retry the click until the dialog opens.
  await creatorPage.goto('/app/categories');
  const categoryName = creatorPage.getByLabel('Название категории');
  await expect(async () => {
    await creatorPage.getByRole('button', { name: 'Создать категорию' }).first().click();
    await expect(categoryName).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await categoryName.fill('Продукты');
  await creatorPage.getByRole('combobox', { name: 'Тип категории' }).click();
  await creatorPage.getByRole('option', { name: 'Расход' }).click();
  await creatorPage.getByRole('button', { name: 'Сохранить категорию' }).click();
  await expect(creatorPage.getByTestId('toast-stack')).toContainText('Категория создана');

  // 2. Invite the member keeping the default role («Участник»/EDITOR).
  await creatorPage.goto('/app/settings/family');
  await waitForHydration(creatorPage);
  await creatorPage.getByRole('button', { name: 'Пригласить' }).click();
  const inviteDialog = creatorPage.getByRole('dialog', { name: 'Пригласить в семью' });
  await expect(inviteDialog).toBeVisible();
  await inviteDialog.getByLabel('Email').fill(memberEmail);
  await inviteDialog.getByRole('button', { name: 'Пригласить' }).click();

  // 3. Read the invite link from the readonly field in the dialog.
  const inviteLinkField = inviteDialog.getByLabel('Ссылка-приглашение');
  await expect(inviteLinkField).toBeVisible();
  const inviteUrl = await inviteLinkField.inputValue();
  expect(inviteUrl).toContain('/invite');

  // The invited member opens the link in a separate, signed-out context.
  await memberPage.goto(inviteUrl);
  await waitForHydration(memberPage);
  await expect(memberPage.getByText(/приглашает вас в семью/)).toBeVisible();
  await memberPage.getByRole('link', { name: 'Создать аккаунт' }).click();
  await expect(memberPage).toHaveURL(/\/register\?invite=1$/);

  // 4. Register with the invited email, accept consents, enter a name and
  // accept the invitation on the welcome step.
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

  // 5. Members spend only from their own accounts, so she sets one up first.
  await memberPage.goto('/app/accounts');
  await waitForHydration(memberPage);
  await memberPage.getByRole('button', { name: 'Создать счёт' }).first().click();
  await memberPage.getByLabel('Название счёта').fill('Карта Алии');
  await memberPage.getByLabel('Начальный баланс').fill('5 000,00');
  await memberPage.getByLabel('Дата начала учёта').pressSequentially('04092026');
  await memberPage.getByRole('button', { name: 'Сохранить счёт' }).click();
  await expect(memberPage.getByTestId('toast-stack')).toContainText('Счёт создан');

  // Add an expense through the quick entry dialog.
  await memberPage.goto('/app/operations');
  await waitForHydration(memberPage);
  // The sidebar's «Добавить операцию или перевод» trigger also matches by
  // substring; scope to the page content.
  await memberPage.getByRole('main').getByRole('button', { name: 'Добавить операцию' }).click();
  await memberPage.getByTestId('operation-type-expense').click();
  await expect(memberPage.getByTestId('entry-tab-EXPENSE')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await memberPage.getByLabel('Сумма').fill('500');
  await memberPage.getByRole('radiogroup', { name: 'Счёт' }).getByRole('radio').first().click();
  await memberPage
    .getByRole('radiogroup', { name: 'Категория' })
    .getByRole('radio')
    .first()
    .click();
  await memberPage.getByTestId('entry-submit').click();
  await expect(memberPage.getByText('Операция сохранена')).toBeVisible();

  // The creator's journal shows the member's name as the operation's author
  // now that the family has more than one member.
  await creatorPage.goto('/app/operations');
  await waitForHydration(creatorPage);
  // Scoped to the row author: the author filter lists the same name.
  await expect(creatorPage.locator('.operation-row__author', { hasText: 'Алия' })).toBeVisible();

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
