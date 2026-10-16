import { expect, test } from '@playwright/test';

test.describe('landing page', () => {
  test('presents the hero promise and the page metadata', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/');

    await expect(page).toHaveTitle('HarmoFin — управляйте личными и семейными финансами');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Знайте, сколько можно потратить, не задевая платежи и накопления.',
    );
    expect(consoleErrors).toEqual([]);
  });

  test('navigates to the anchors from the header', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await page.getByRole('link', { name: 'Безопасность' }).first().click();

    await expect(page).toHaveURL(/#security$/);
    await expect(page.locator('#security')).toBeInViewport();
  });

  test('sends both calls to action to the auth routes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await expect(page.getByRole('link', { name: 'Начать бесплатно' }).first()).toHaveAttribute(
      'href',
      '/register',
    );
    await expect(page.getByRole('link', { name: 'Войти' }).first()).toHaveAttribute(
      'href',
      '/login',
    );
  });

  test('operates the FAQ accordion with the keyboard', async ({ page }) => {
    await page.goto('/');

    // The server-rendered markup carries the accordion's buttons before Vue has
    // hydrated, so a key press sent too early lands on an element with no
    // listener. `is-reveal-ready` is set by client-side code on mount, which
    // makes it a reliable "the page is interactive now" signal.
    // Either class means mount ran: `is-revealed` is what the immediate-reveal
    // paths (reduced motion, no IntersectionObserver) set instead.
    await expect(
      page
        .locator('.landing-section__inner.is-reveal-ready, .landing-section__inner.is-revealed')
        .first(),
    ).toBeAttached();

    const question = page.getByRole('button', { name: 'Что такое HarmoFin?' });
    await question.press('Enter');

    await expect(question).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'Что такое HarmoFin?' })).toBeVisible();

    await question.press('Enter');
    await expect(question).toHaveAttribute('aria-expanded', 'false');
  });

  test('never overflows horizontally on narrow screens', async ({ page }) => {
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');

      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement;
        return root ? root.scrollWidth - root.clientWidth : 0;
      });

      expect(overflow, `viewport ${width}px`).toBeLessThanOrEqual(0);
    }
  });
});
