import { expect, test, type Page } from '@playwright/test';

async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
}

test('walks the demo with a custom cycle through both choices to the final step', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('link', { name: 'Попробовать демо →' }).click();
  await expect(page).toHaveURL(/\/demo/);
  await waitForHydration(page);

  await expect(
    page.getByRole('heading', { level: 2, name: 'Настройте финансовый цикл' }),
  ).toBeVisible();
  await page.getByLabel('Начало первого периода').fill('5');
  await page.getByLabel('Граница второго периода (дней от начала первого)').fill('10');
  await page.getByRole('button', { name: 'Далее' }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Пришла зарплата' })).toBeVisible();
  await expect(page.getByText('5 октября на карту пришли 120 000 ₽')).toBeVisible();
  await page.getByRole('button', { name: 'Далее' }).click();

  await expect(page.getByRole('button', { name: 'Далее' })).toBeDisabled();
  await page.getByRole('button', { name: /Больше отложить на отпуск/ }).click();
  await page.getByRole('button', { name: 'Далее' }).click();

  await expect(page.getByText('9 октября списали 36 000 ₽ за ипотеку')).toBeVisible();
  await page.getByRole('button', { name: 'Далее' }).click();
  await expect(page.getByText(/потратили 12 400 ₽/)).toBeVisible();
  await page.getByRole('button', { name: 'Далее' }).click();

  await page.getByRole('button', { name: /Отложить в накопления/ }).click();
  await page.getByRole('button', { name: 'Далее' }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Итог месяца' })).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get('step')).toBe('6');
  expect(url.searchParams.get('start')).toBe('5');
  expect(url.searchParams.get('offset')).toBe('10');
  expect(url.searchParams.get('split')).toBe('vacation');
  expect(url.searchParams.get('leftover')).toBe('save');
  await expect(page.locator('[data-action="demo-register"]')).toHaveAttribute('href', '/register');

  await page.reload();
  await waitForHydration(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Итог месяца' })).toBeVisible();
});
