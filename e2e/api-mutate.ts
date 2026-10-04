import { expect, type APIResponse, type Page } from '@playwright/test';
import { apiV1, webOrigin } from './env';

// SETUP helper: a mutating API call made with the browser session cookie.
// The API requires the web Origin on every unsafe method (OriginGuard) and a
// CSRF token that is rotated on each GET /auth/csrf (the web app reads it too),
// so a stale token is refreshed once and the same request (same idempotency
// key) is repeated, as useApiClient does.

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function problemCode(response: APIResponse): Promise<string | undefined> {
  try {
    return ((await response.json()) as { code?: string }).code;
  } catch {
    return undefined;
  }
}

async function freshCsrf(page: Page): Promise<string> {
  const response = await page.request.get(`${apiV1}/auth/csrf`);
  expect(response.ok(), `${apiV1}/auth/csrf -> ${response.status()}`).toBe(true);
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}

export async function apiMutate<T = unknown>(
  page: Page,
  url: string,
  body: unknown,
  method: Method = 'POST',
): Promise<T> {
  const idempotencyKey = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const send = async (csrfToken: string): Promise<APIResponse> =>
    page.request.fetch(url, {
      method,
      data: body,
      headers: {
        Origin: webOrigin,
        'X-CSRF-Token': csrfToken,
        'Idempotency-Key': idempotencyKey,
      },
    });

  let response = await send(await freshCsrf(page));
  if (response.status() === 403 && (await problemCode(response)) === 'CSRF_INVALID') {
    response = await send(await freshCsrf(page));
  }
  if (!response.ok()) {
    const text = await response.text();
    const hint = text.includes('ORIGIN_REQUIRED')
      ? ` (ORIGIN_REQUIRED: Origin header "${webOrigin}" differs from API WEB_ORIGIN)`
      : '';
    expect(
      response.ok(),
      `${method} ${url} -> ${response.status()}${hint} ${text.slice(0, 300)}`,
    ).toBe(true);
  }
  return (await response.json()) as T;
}
