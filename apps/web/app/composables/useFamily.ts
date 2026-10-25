import { ref, type Ref } from 'vue';
import { reloadNuxtApp } from '#imports';

import { useApiClient } from './useApiClient.js';
import { useActiveWorkspace } from './useActiveWorkspace.js';
import { useAuth } from './useAuth.js';

export type FamilyRole = 'OWNER' | 'EDITOR' | 'VIEWER';
export type Member = {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: FamilyRole;
  isCreator: boolean;
  joinedAt: string;
};
export type Invitation = {
  id: string;
  email: string;
  role: 'EDITOR' | 'VIEWER';
  status: 'PENDING' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
};
export type CreatedInvitation = Invitation & { inviteUrl: string };

export function useFamily(workspaceId: Ref<string | undefined>) {
  const api = useApiClient();
  const auth = useAuth();
  const { isCreator } = useActiveWorkspace();
  const members = ref<Member[]>([]);
  const invitations = ref<Invitation[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const base = () => `/api/v1/workspaces/${encodeURIComponent(workspaceId.value ?? '')}`;

  async function load(): Promise<void> {
    if (!workspaceId.value) return;
    loading.value = true;
    error.value = null;
    try {
      members.value = await api.request<Member[]>(`${base()}/members`);
      invitations.value = isCreator.value
        ? await api.request<Invitation[]>(`${base()}/invitations`)
        : [];
    } catch {
      error.value = 'Не удалось загрузить участников. Попробуйте обновить страницу.';
    } finally {
      loading.value = false;
    }
  }

  async function invite(email: string, role: 'EDITOR' | 'VIEWER'): Promise<CreatedInvitation> {
    const created = await api.request<CreatedInvitation>(`${base()}/invitations`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    });
    await load();
    return created;
  }

  async function resend(id: string): Promise<CreatedInvitation> {
    const created = await api.request<CreatedInvitation>(
      `${base()}/invitations/${encodeURIComponent(id)}/resend`,
      { method: 'POST' },
    );
    await load();
    return created;
  }

  async function revoke(id: string): Promise<void> {
    await api.request(`${base()}/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  }

  async function changeRole(membershipId: string, role: 'EDITOR' | 'VIEWER'): Promise<void> {
    await api.request(`${base()}/members/${encodeURIComponent(membershipId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    await load();
  }

  async function removeMember(membershipId: string): Promise<void> {
    await api.request(`${base()}/members/${encodeURIComponent(membershipId)}`, {
      method: 'DELETE',
    });
    await load();
  }

  // Leaving drops access to the whole family budget, so every page/composable
  // needs the same full reload that selectWorkspace uses when switching
  // workspaces — a client-side navigateTo would leave stale family data in
  // memory (dashboard, journal caches) that onMounted never re-fetches.
  async function leave(): Promise<void> {
    await api.request(`${base()}/leave`, { method: 'POST' });
    await auth.loadMe();
    await reloadNuxtApp({ path: '/app' });
  }

  return {
    members,
    invitations,
    loading,
    error,
    load,
    invite,
    resend,
    revoke,
    changeRole,
    removeMember,
    leave,
  };
}
