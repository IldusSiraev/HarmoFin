import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('./useApiClient.js', async () => {
  const actual = await vi.importActual<typeof import('./useApiClient.js')>('./useApiClient.js');
  return { ...actual, useApiClient: () => mocks };
});

import { readTokenFromHash, useInvitation } from './useInvitation.js';

describe('readTokenFromHash', () => {
  it('extracts a token from a hash fragment', () => {
    expect(readTokenFromHash('#token=abc-DEF_1')).toBe('abc-DEF_1');
  });

  it('returns null for an empty hash', () => {
    expect(readTokenFromHash('')).toBeNull();
    expect(readTokenFromHash('#')).toBeNull();
  });

  it('returns null when the hash has no token parameter', () => {
    expect(readTokenFromHash('#foo=bar')).toBeNull();
  });

  it('returns null when the token contains characters outside the allowed set', () => {
    expect(readTokenFromHash('#token=abc%20def')).toBeNull();
  });
});

describe('useInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('previews an invitation by posting the token without session cookies affecting the call', async () => {
    mocks.request.mockResolvedValue({
      workspaceName: 'Сираевы',
      inviterName: 'Ильдар',
      role: 'EDITOR',
      maskedEmail: 'i***@example.com',
      expiresAt: '2026-11-01T00:00:00.000Z',
    });
    const { preview } = useInvitation();

    const result = await preview('a-valid-looking-token-value');

    expect(mocks.request).toHaveBeenCalledWith('/api/v1/invitations/preview', {
      method: 'POST',
      body: JSON.stringify({ token: 'a-valid-looking-token-value' }),
    });
    expect(result.workspaceName).toBe('Сираевы');
  });

  it('accepts an invitation with an optional display name', async () => {
    mocks.request.mockResolvedValue({ workspaceId: 'w1', budgetId: 'b1' });
    const { accept } = useInvitation();

    await accept('token-value', 'Анна');

    expect(mocks.request).toHaveBeenCalledWith('/api/v1/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token: 'token-value', displayName: 'Анна' }),
    });
  });

  it('accepts an invitation without a display name', async () => {
    mocks.request.mockResolvedValue({ workspaceId: 'w1', budgetId: 'b1' });
    const { accept } = useInvitation();

    await accept('token-value');

    expect(mocks.request).toHaveBeenCalledWith('/api/v1/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token: 'token-value' }),
    });
  });
});
