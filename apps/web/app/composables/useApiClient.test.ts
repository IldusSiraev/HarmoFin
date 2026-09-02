import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from './useApiClient.js';

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
});
