import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  requestBlob: vi.fn(),
  reloadNuxtApp: vi.fn(),
}));

vi.mock('./useApiClient.js', async () => {
  const actual = await vi.importActual<typeof import('./useApiClient.js')>('./useApiClient.js');
  return { ...actual, useApiClient: () => mocks };
});

vi.mock('#imports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#imports')>();
  return { ...actual, reloadNuxtApp: mocks.reloadNuxtApp };
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
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/auth/sessions/session-1', {
      method: 'DELETE',
    });
  });

  it('revokeAllSessions deletes every session', async () => {
    mocks.request.mockResolvedValue(undefined);
    const { revokeAllSessions } = useAuth();
    await revokeAllSessions();
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/auth/sessions', { method: 'DELETE' });
  });
  it('loadMe keeps planModelVersion per budget and stores no token in localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    mocks.request.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.test', displayName: null },
      workspaces: [
        {
          id: 'w1',
          name: 'W',
          role: 'OWNER',
          budgets: [{ id: 'b2', name: 'New', primaryCurrency: 'RUB', planModelVersion: 2 }],
        },
      ],
    });
    const { loadMe, currentData } = useAuth();
    const data = await loadMe();
    const budgets = data.workspaces.at(0)?.budgets ?? [];
    const versions: number[] = budgets.map((budget) => budget.planModelVersion);
    expect(versions).toEqual([2]);
    expect(currentData.value?.workspaces.at(0)?.budgets.at(0)?.planModelVersion).toBe(2);
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/me');
    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(Object.entries(globalThis.localStorage ?? {}))).not.toMatch(/token/i);
    setItem.mockRestore();
  });

  it('selectWorkspace selects, reloads me, then forces a full reload to the dashboard', async () => {
    mocks.request
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ user: { id: 'u1', email: 'a@b.test', displayName: null } });
    const { selectWorkspace } = useAuth();

    await selectWorkspace('workspace-2');

    expect(mocks.request).toHaveBeenNthCalledWith(1, '/api/v1/workspaces/workspace-2/select', {
      method: 'POST',
    });
    expect(mocks.request).toHaveBeenNthCalledWith(2, '/api/v1/me');
    expect(mocks.reloadNuxtApp).toHaveBeenCalledWith({ path: '/app' });
    const requestOrder = mocks.request.mock.invocationCallOrder[1]!;
    const reloadOrder = mocks.reloadNuxtApp.mock.invocationCallOrder[0]!;
    expect(reloadOrder).toBeGreaterThan(requestOrder);
  });

  it('createPersonalWorkspace creates, reloads me, then forces a full reload to the dashboard', async () => {
    mocks.request
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ user: { id: 'u1', email: 'a@b.test', displayName: null } });
    const { createPersonalWorkspace } = useAuth();

    await createPersonalWorkspace();

    expect(mocks.request).toHaveBeenNthCalledWith(1, '/api/v1/workspaces', {
      method: 'POST',
      body: JSON.stringify({ workspaceName: 'Мой бюджет', budgetName: 'Мой бюджет' }),
    });
    expect(mocks.request).toHaveBeenNthCalledWith(2, '/api/v1/me');
    expect(mocks.reloadNuxtApp).toHaveBeenCalledWith({ path: '/app' });
    const requestOrder = mocks.request.mock.invocationCallOrder[1]!;
    const reloadOrder = mocks.reloadNuxtApp.mock.invocationCallOrder[0]!;
    expect(reloadOrder).toBeGreaterThan(requestOrder);
  });
});
