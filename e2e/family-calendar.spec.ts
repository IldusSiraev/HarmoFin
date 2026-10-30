import { expect, test, type Page } from '@playwright/test';

const password = 'e2e-password-10';

// Family calendar: the author's weekly event is read-only for everyone else, and a member can
// still add her own event. Mirrors the family-ownership ownership matrix for the calendar domain.
test('a family shares a weekly event; the member sees it but cannot edit it', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const creator = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const creatorPage = await creator.newPage();
  const member = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const memberPage = await member.newPage();
  const stamp = Date.now();

  // 1. Creator with a name; invite and register the member.
  await registerAccount(creatorPage, `e2e-cal-creator-${stamp}@harmofin.test`);
  await setDisplayName(creatorPage, 'Ильдар');
  await inviteAndJoin(creatorPage, memberPage, `e2e-cal-member-${stamp}@harmofin.test`, 'Алия');

  // 2. Creator adds a weekly event with the member as participant.
  await creatorPage.goto('/app/calendar?view=month');
  await waitForHydration(creatorPage);
  await creatorPage.getByTestId('calendar-create').click();
  const form = creatorPage.getByRole('dialog', { name: 'Новое событие' });
  await form.getByLabel('Название').fill('Кружок рисования');
  await form.getByLabel('Начало').fill('17:00');
  await form.getByLabel('Конец').fill('18:30');
  await form.getByRole('combobox', { name: 'Повторять' }).click();
  await creatorPage.getByRole('option', { name: 'Каждую неделю' }).click();
  await form.getByRole('button', { name: 'Алия' }).click();
  await form.getByRole('button', { name: 'Сохранить событие' }).click();
  await expect(creatorPage.getByTestId('toast-stack')).toContainText('Событие сохранено');
  await expect(creatorPage.getByRole('grid')).toContainText('17:00 Кружок рисования');

  // 3. The member sees it in the agenda, read-only.
  await memberPage.goto('/app/calendar?view=agenda');
  await waitForHydration(memberPage);
  const row = memberPage
    .locator('[data-testid^="agenda-item-"]', { hasText: 'Кружок рисования' })
    .first();
  await expect(row).toContainText('17:00');
  await row.getByRole('button').click();
  const card = memberPage.getByRole('dialog', { name: 'Кружок рисования' });
  await expect(card).toContainText('Изменять событие может только автор');
  await expect(card.getByRole('button', { name: 'Изменить событие' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Закрыть' }).click();

  // 4. The member creates her own all-day event.
  await memberPage.getByTestId('calendar-create').click();
  const ownForm = memberPage.getByRole('dialog', { name: 'Новое событие' });
  await ownForm.getByLabel('Название').fill('День рождения бабушки');
  await ownForm.getByRole('switch', { name: 'Весь день' }).click();
  await ownForm.getByRole('button', { name: 'Сохранить событие' }).click();
  await expect(memberPage.getByTestId('toast-stack')).toContainText('Событие сохранено');
  await expect(
    memberPage.locator('[data-testid^="agenda-item-"]', { hasText: 'День рождения бабушки' }),
  ).toBeVisible();

  await creator.close();
  await member.close();
});

// Below 1024px the page opens on "Повестка" by default (CalendarPage onMounted); the dark theme
// uses the same tokens as the rest of the app, so the only risk worth a regression test is layout
// overflow on a narrow viewport.
test('mobile agenda in the dark theme has no horizontal scroll', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await registerAccount(page, `e2e-cal-mobile-${Date.now()}@harmofin.test`);
  await page.goto('/app/calendar');
  await waitForHydration(page);
  await expect(page.getByTestId('calendar-view-agenda')).toHaveAttribute('aria-pressed', 'true');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
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
