import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

// Family activity feed: what the member did shows up for the creator as new, and opening the feed
// clears the navigation counter.
test('the creator sees a member event in the feed and the counter clears', async ({ browser }) => {
  test.setTimeout(180_000);
  const creator = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const creatorPage = await creator.newPage();
  const member = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const memberPage = await member.newPage();
  const stamp = Date.now();

  await registerAccount(creatorPage, `e2e-feed-creator-${stamp}@harmofin.test`);
  await setDisplayName(creatorPage, 'Ильдар');
  await inviteAndJoin(creatorPage, memberPage, `e2e-feed-member-${stamp}@harmofin.test`, 'Алия');

  // The member adds an all-day event.
  await memberPage.goto('/app/calendar?view=agenda');
  await waitForHydration(memberPage);
  await memberPage.getByTestId('calendar-create').click();
  const form = memberPage.getByRole('dialog', { name: 'Новое событие' });
  await form.getByLabel('Название').fill('Родительское собрание');
  await form.getByRole('switch', { name: 'Весь день' }).click();
  await form.getByRole('button', { name: 'Сохранить событие' }).click();
  await expect(memberPage.getByTestId('toast-stack')).toContainText('Событие сохранено');

  // The creator sees it on the dashboard as new, together with the member joining the family.
  // The dashboard has no hydration marker, so wait for the card itself (it loads after mount).
  await creatorPage.goto('/app');
  const card = creatorPage.getByTestId('family-activity-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Алия · новое событие');
  await expect(card).toContainText('Родительское собрание');
  await expect(card).toContainText('Алия · в семье');
  await expect(card).toContainText('2 новых');

  // Opening the feed shows it under «Новое» and clears the counter in the sidebar.
  // The sidebar is the aside labelled «Основная навигация»; other navigation regions exist on the page.
  const nav = creatorPage.getByRole('complementary', { name: 'Основная навигация' });
  await expect(nav.getByRole('link', { name: /Лентаs*,s*2 новых события/ })).toBeVisible();
  await card.getByRole('link', { name: 'Все события' }).click();
  await waitForHydration(creatorPage);
  await expect(creatorPage.getByTestId('activity-new')).toContainText('Родительское собрание');
  await expect(nav.getByRole('link', { name: 'Лента', exact: true })).toBeVisible();

  await creator.close();
  await member.close();
});

// --- helpers copied from e2e/family-calendar.spec.ts ---

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

// Invites `email` from the creator's family settings page and completes the member's
// registration and onboarding (display name `name`) on the invite link, landing on `/app`.
async function inviteAndJoin(
  creatorPage: Page,
  memberPage: Page,
  email: string,
  name: string,
): Promise<void> {
  await creatorPage.goto('/app/settings/family');
  await waitForHydration(creatorPage);
  await creatorPage.getByRole('button', { name: 'Пригласить' }).click();
  const inviteDialog = creatorPage.getByRole('dialog', { name: 'Пригласить в семью' });
  await expect(inviteDialog).toBeVisible();
  await inviteDialog.getByLabel('Email').fill(email);
  await inviteDialog.getByRole('button', { name: 'Пригласить' }).click();
  const inviteUrl = await inviteDialog.getByLabel('Ссылка-приглашение').inputValue();
  expect(inviteUrl).toContain('/invite');

  await memberPage.goto(inviteUrl);
  await waitForHydration(memberPage);
  await expect(memberPage.getByText(/приглашает вас в семью/)).toBeVisible();
  await memberPage.getByRole('link', { name: 'Создать аккаунт' }).click();
  await waitForHydration(memberPage);
  await memberPage.getByLabel('Email').fill(email);
  await memberPage.getByLabel('Пароль').fill(password);
  await memberPage.getByRole('checkbox', { name: /пользовательское соглашение/ }).check();
  await memberPage.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await memberPage.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(memberPage).toHaveURL(/\/invite\?welcome=1$/);
  await waitForHydration(memberPage);
  await memberPage.getByLabel('Ваше имя').fill(name);
  await memberPage.getByRole('button', { name: 'Продолжить' }).click();
  await expect(memberPage).toHaveURL(/\/app$/);
}
