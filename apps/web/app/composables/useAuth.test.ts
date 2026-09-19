import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), requestBlob: vi.fn() }));

vi.mock('./useApiClient.js', async () => {
  const actual = await vi.importActual<typeof import('./useApiClient.js')>('./useApiClient.js');
  return { ...actual, useApiClient: () => mocks };
});

import { useAuth } from './useAuth.js';

describe('useAuth session and password management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('changePassword posts current and new password', async () => {
    mocks.request.mockResolvedValue({});
    const { changePassword } = useAuth();
    await changePassword({ currentPassword: 'old-password', newPassword: 'new-password-10' });
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/v1/auth/password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'old-password', newPassword: 'new-password-10' }),
      }),
    );
  });

  it('listSessions requests the sessions list', async () => {
    mocks.request.mockResolvedValue([{ id: 'session-1' }]);
    const { listSessions } = useAuth();
    const result = await listSessions();
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/auth/sessions');
    expect(result).toEqual([{ id: 'session-1' }]);
  });

  it('revokeSession deletes a single session by id', async () => {
    mocks.request.mockResolvedValue(undefined);
    const { revokeSession } = useAuth();
    await revokeSession('session-1');
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/auth/sessions/session-1', { method: 'DELETE' });
  });

  it('revokeAllSessions deletes every session', async () => {
    mocks.request.mockResolvedValue(undefined);
    const { revokeAllSessions } = useAuth();
    await revokeAllSessions();
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/auth/sessions', { method: 'DELETE' });
  });
});
