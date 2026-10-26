import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const api = { request: vi.fn() };
const isCreator = ref(true);
const auth = { loadMe: vi.fn() };
const mocks = vi.hoisted(() => ({ reloadNuxtApp: vi.fn() }));

vi.mock('./useApiClient.js', () => ({ useApiClient: () => api }));
vi.mock('./useActiveWorkspace.js', () => ({ useActiveWorkspace: () => ({ isCreator }) }));
vi.mock('./useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('#imports', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reloadNuxtApp: mocks.reloadNuxtApp,
}));

import { useFamily } from './useFamily.js';

const workspaceId = ref<string | undefined>('workspace-id');

describe('useFamily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads members and invitations for a creator', async () => {
    isCreator.value = true;
    api.request.mockResolvedValueOnce([{ membershipId: 'm1' }]);
    api.request.mockResolvedValueOnce([{ id: 'i1' }]);

    const { load, members, invitations } = useFamily(workspaceId);
    await load();

    expect(api.request).toHaveBeenNthCalledWith(1, '/api/v1/workspaces/workspace-id/members');
    expect(api.request).toHaveBeenNthCalledWith(2, '/api/v1/workspaces/workspace-id/invitations');
    expect(members.value).toEqual([{ membershipId: 'm1' }]);
    expect(invitations.value).toEqual([{ id: 'i1' }]);
  });

  it('does not request invitations for a non-creator', async () => {
    isCreator.value = false;
    api.request.mockResolvedValueOnce([{ membershipId: 'm1' }]);

    const { load, invitations } = useFamily(workspaceId);
    await load();

    expect(api.request).toHaveBeenCalledTimes(1);
    expect(invitations.value).toEqual([]);
  });

  it('invite posts email and role, returns the invitation with its inviteUrl, and reloads', async () => {
    isCreator.value = true;
    const created = {
      id: 'i1',
      email: 'a@b.test',
      role: 'EDITOR',
      inviteUrl: 'https://x/invite/1',
    };
    api.request.mockResolvedValueOnce(created);
    api.request.mockResolvedValueOnce([]);
    api.request.mockResolvedValueOnce([]);

    const { invite } = useFamily(workspaceId);
    const result = await invite('a@b.test', 'EDITOR');

    expect(api.request).toHaveBeenNthCalledWith(1, '/api/v1/workspaces/workspace-id/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.test', role: 'EDITOR' }),
    });
    expect(result).toEqual(created);
    expect(result.inviteUrl).toBe('https://x/invite/1');
  });

  it('resend posts to the resend endpoint', async () => {
    isCreator.value = true;
    const created = { id: 'i1', inviteUrl: 'https://x/invite/1' };
    api.request.mockResolvedValueOnce(created);
    api.request.mockResolvedValueOnce([]);
    api.request.mockResolvedValueOnce([]);

    const { resend } = useFamily(workspaceId);
    await resend('i1');

    expect(api.request).toHaveBeenNthCalledWith(
      1,
      '/api/v1/workspaces/workspace-id/invitations/i1/resend',
      { method: 'POST' },
    );
  });

  it('revoke deletes the invitation', async () => {
    isCreator.value = true;
    api.request.mockResolvedValueOnce(undefined);
    api.request.mockResolvedValueOnce([]);
    api.request.mockResolvedValueOnce([]);

    const { revoke } = useFamily(workspaceId);
    await revoke('i1');

    expect(api.request).toHaveBeenNthCalledWith(
      1,
      '/api/v1/workspaces/workspace-id/invitations/i1',
      { method: 'DELETE' },
    );
  });

  it('changeRole patches the member role', async () => {
    isCreator.value = true;
    api.request.mockResolvedValueOnce(undefined);
    api.request.mockResolvedValueOnce([]);
    api.request.mockResolvedValueOnce([]);

    const { changeRole } = useFamily(workspaceId);
    await changeRole('m1', 'VIEWER');

    expect(api.request).toHaveBeenNthCalledWith(1, '/api/v1/workspaces/workspace-id/members/m1', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'VIEWER' }),
    });
  });

  it('removeMember deletes the membership', async () => {
    isCreator.value = true;
    api.request.mockResolvedValueOnce(undefined);
    api.request.mockResolvedValueOnce([]);
    api.request.mockResolvedValueOnce([]);

    const { removeMember } = useFamily(workspaceId);
    await removeMember('m1');

    expect(api.request).toHaveBeenNthCalledWith(1, '/api/v1/workspaces/workspace-id/members/m1', {
      method: 'DELETE',
    });
  });

  it('leave posts to /leave, refreshes the session and fully reloads to /app', async () => {
    api.request.mockResolvedValueOnce(undefined);
    auth.loadMe.mockResolvedValueOnce(undefined);

    const { leave } = useFamily(workspaceId);
    await leave();

    expect(api.request).toHaveBeenCalledWith('/api/v1/workspaces/workspace-id/leave', {
      method: 'POST',
    });
    expect(auth.loadMe).toHaveBeenCalled();
    expect(mocks.reloadNuxtApp).toHaveBeenCalledWith({ path: '/app' });
  });
});
