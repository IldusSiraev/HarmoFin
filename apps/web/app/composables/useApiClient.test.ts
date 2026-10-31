import { describe, expect, it, vi } from 'vitest';

import { createApiClient, createCsrfStore } from './useApiClient.js';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe('createApiClient', () => {
  it('sends cookies and Origin on every request', async () => {
    const fetcher = vi.fn<Fetcher>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const client = createApiClient(fetcher, 'http://localhost:3001', 'http://localhost:3000');

    await client.request('/api/v1/me');

    const options = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(options).toMatchObject({ credentials: 'include' });
    expect(new Headers(options?.headers).get('Origin')).toBe('http://localhost:3000');
  });

  it('adds memory-only CSRF header only to unsafe requests', async () => {
    const fetcher = vi.fn<Fetcher>(
      async () => new Response(JSON.stringify({ csrfToken: 'csrf-token' }), { status: 200 }),
    );
    const client = createApiClient(fetcher, 'http://localhost:3001', 'http://localhost:3000');

    await client.request('/api/v1/auth/password', { method: 'POST', body: '{}' });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3001/api/v1/auth/csrf',
      expect.objectContaining({ credentials: 'include' }),
    );
    const mutationOptions = fetcher.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(new Headers(mutationOptions?.headers).get('X-CSRF-Token')).toBe('csrf-token');
  });

  it('accepts successful empty responses', async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response(null, { status: 202 }));
    const client = createApiClient(fetcher, 'http://localhost:3001', 'http://localhost:3000');

    await expect(
      client.request('/api/v1/auth/recovery/request', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com' }),
      }),
    ).resolves.toBeUndefined();
  });

  it('cancels account deletion without a session-bound CSRF token', async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response(null, { status: 204 }));
    const client = createApiClient(fetcher, 'http://localhost:3001', 'http://localhost:3000');

    await expect(
      client.request('/api/v1/auth/deletion/cancel', {
        method: 'POST',
        body: JSON.stringify({ token: 'raw-token' }),
      }),
    ).resolves.toBeUndefined();

    // The restore link is opened signed out: /auth/csrf would answer 401.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'http://localhost:3001/api/v1/auth/deletion/cancel',
    );
  });

  it('previews an invitation without a session-bound CSRF token', async () => {
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response(JSON.stringify({ workspaceName: 'Сираевы' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = createApiClient(fetcher, 'http://localhost:3001', 'http://localhost:3000');

    await expect(
      client.request('/api/v1/invitations/preview', {
        method: 'POST',
        body: JSON.stringify({ token: 'raw-token' }),
      }),
    ).resolves.toMatchObject({ workspaceName: 'Сираевы' });

    // Opened signed out from an invite link: /auth/csrf would answer 401.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'http://localhost:3001/api/v1/invitations/preview',
    );
  });

  it('confirms email verification without a session-bound CSRF token', async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response(null, { status: 204 }));
    const client = createApiClient(fetcher, 'http://localhost:3001', 'http://localhost:3000');

    await expect(
      client.request('/api/v1/auth/email-verification/confirm', {
        method: 'POST',
        body: JSON.stringify({ token: 'raw-token' }),
      }),
    ).resolves.toBeUndefined();

    // Opened from the letter, possibly signed out: /auth/csrf would answer 401.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'http://localhost:3001/api/v1/auth/email-verification/confirm',
    );
    expect(
      new Headers((fetcher.mock.calls[0]?.[1] as RequestInit).headers).has('X-CSRF-Token'),
    ).toBe(false);
  });

  it('unsubscribes from a letter without a session-bound CSRF token', async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response(null, { status: 204 }));
    const client = createApiClient(fetcher, 'http://localhost:3001', 'http://localhost:3000');

    await expect(
      client.request('/api/v1/notifications/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ token: 'raw-token' }),
      }),
    ).resolves.toBeUndefined();

    // Opened from a letter, possibly signed out: the token in the body is enough.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'http://localhost:3001/api/v1/notifications/unsubscribe',
    );
    expect(
      new Headers((fetcher.mock.calls[0]?.[1] as RequestInit).headers).has('X-CSRF-Token'),
    ).toBe(false);
  });

  it('downloads Blob with session policy and parses Problem Details errors', async () => {
    const successFetcher = vi.fn<Fetcher>(async () => new Response('csv', { status: 200 }));
    const successClient = createApiClient(
      successFetcher,
      'http://localhost:3001',
      'http://localhost:3000',
    );

    const blob = await successClient.requestBlob(
      '/api/v1/budgets/budget-id/exports/transactions.csv',
    );

    const options = successFetcher.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(options).toMatchObject({ credentials: 'include' });
    expect(new Headers(options?.headers).get('Origin')).toBe('http://localhost:3000');
    expect(new Headers(options?.headers).has('Content-Type')).toBe(false);
    await expect(blob.text()).resolves.toBe('csv');

    const errorClient = createApiClient(
      async () =>
        new Response(
          JSON.stringify({ code: 'EXPORT_LIMIT_EXCEEDED', detail: 'Сузьте фильтры журнала.' }),
          { status: 422, headers: { 'content-type': 'application/json' } },
        ),
      'http://localhost:3001',
      'http://localhost:3000',
    );
    await expect(
      errorClient.requestBlob('/api/v1/budgets/budget-id/exports/transactions.csv'),
    ).rejects.toMatchObject({ status: 422, problem: { code: 'EXPORT_LIMIT_EXCEEDED' } });
  });

  it('shares one CSRF token between clients that use the same store', async () => {
    const fetcher = vi.fn<Fetcher>(
      async () => new Response(JSON.stringify({ csrfToken: 'csrf-token' }), { status: 200 }),
    );
    const store = createCsrfStore();
    const first = createApiClient(fetcher, 'http://localhost:3001', 'http://localhost:3000', store);
    const second = createApiClient(
      fetcher,
      'http://localhost:3001',
      'http://localhost:3000',
      store,
    );

    await first.request('/api/v1/budgets/budget-id/transactions', { method: 'POST', body: '{}' });
    await second.request('/api/v1/budgets/budget-id/transfers', { method: 'POST', body: '{}' });

    // The server rotates the token on every /auth/csrf read, so a second read
    // would invalidate the token the first client still holds.
    const csrfReads = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/auth/csrf'));
    expect(csrfReads).toHaveLength(1);
  });

  it('takes a fresh token and repeats the request once when the token went stale', async () => {
    let issued = 0;
    const fetcher = vi.fn<Fetcher>(async (url, init) => {
      if (String(url).endsWith('/auth/csrf')) {
        issued += 1;
        return new Response(JSON.stringify({ csrfToken: `token-${issued}` }), { status: 200 });
      }
      const token = new Headers(init?.headers).get('X-CSRF-Token');
      if (token !== 'token-2')
        return new Response(
          JSON.stringify({ code: 'CSRF_INVALID', detail: 'Защита запроса не пройдена.' }),
          {
            status: 403,
            headers: { 'content-type': 'application/json' },
          },
        );
      return new Response(JSON.stringify({ id: 'transaction-id' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = createApiClient(fetcher, 'http://localhost:3001', 'http://localhost:3000');

    const result = await client.request('/api/v1/budgets/budget-id/transactions', {
      method: 'POST',
      body: '{}',
      headers: { 'Idempotency-Key': 'key-1' },
    });

    expect(result).toEqual({ id: 'transaction-id' });
    const mutations = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/transactions'));
    expect(mutations).toHaveLength(2);
    // The retry must carry the same idempotency key: it is the same movement.
    expect(new Headers(mutations[1]?.[1]?.headers).get('Idempotency-Key')).toBe('key-1');
  });

  it('gives up after one retry instead of looping on a rejected token', async () => {
    const fetcher = vi.fn<Fetcher>(async (url) =>
      String(url).endsWith('/auth/csrf')
        ? new Response(JSON.stringify({ csrfToken: 'csrf-token' }), { status: 200 })
        : new Response(
            JSON.stringify({ code: 'CSRF_INVALID', detail: 'Защита запроса не пройдена.' }),
            {
              status: 403,
              headers: { 'content-type': 'application/json' },
            },
          ),
    );
    const client = createApiClient(fetcher, 'http://localhost:3001', 'http://localhost:3000');

    await expect(
      client.request('/api/v1/budgets/budget-id/transactions', { method: 'POST', body: '{}' }),
    ).rejects.toMatchObject({ status: 403, problem: { code: 'CSRF_INVALID' } });

    const mutations = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/transactions'));
    expect(mutations).toHaveLength(2);
  });
});
