import { useState } from '#imports';
import { ApiRequestError, useApiClient } from './useApiClient.js';

type User = { id: string; email: string; displayName: string | null };
type MeResponse = {
  user: User;
  workspaces: Array<{
    id: string;
    name: string;
    role: string;
    budgets: Array<{ id: string; name: string; primaryCurrency: string }>;
  }>;
};

export type SessionView = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  userAgent: string | null;
};

export function useAuth() {
  const api = useApiClient();
  const currentUser = useState<User | null>('auth-user', () => null);
  const currentData = useState<MeResponse | null>('auth-me', () => null);

  async function loadMe(): Promise<MeResponse> {
    const data = await api.request<MeResponse>('/api/v1/me');
    currentUser.value = data.user;
    currentData.value = data;
    return data;
  }

  async function register(input: {
    email: string;
    password: string;
    workspaceName?: string;
    budgetName?: string;
  }) {
    const result = await api.request<{ user: User }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    currentUser.value = result.user;
    return result;
  }

  async function login(input: { email: string; password: string }) {
    const result = await api.request<{ user: User }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    currentUser.value = result.user;
    return result;
  }

  async function requestRecovery(email: string): Promise<void> {
    await api.request('/api/v1/auth/recovery/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async function confirmRecovery(token: string, password: string) {
    const result = await api.request<{ user: User }>('/api/v1/auth/recovery/confirm', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
    currentUser.value = result.user;
    return result;
  }

  async function logout(): Promise<void> {
    await api.request('/api/v1/auth/logout', { method: 'POST' });
    currentUser.value = null;
    currentData.value = null;
  }

  async function changePassword(input: {
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    await api.request('/api/v1/auth/password', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async function listSessions(): Promise<SessionView[]> {
    return api.request<SessionView[]>('/api/v1/auth/sessions');
  }

  async function revokeSession(sessionId: string): Promise<void> {
    await api.request(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
  }

  async function revokeAllSessions(): Promise<void> {
    await api.request('/api/v1/auth/sessions', { method: 'DELETE' });
  }

  return {
    currentUser,
    currentData,
    loadMe,
    register,
    login,
    requestRecovery,
    confirmRecovery,
    logout,
    changePassword,
    listSessions,
    revokeSession,
    revokeAllSessions,
  };
}

export function errorMessage(error: unknown): { summary: string; fields: Record<string, string> } {
  if (!(error instanceof ApiRequestError)) {
    return { summary: 'Не удалось выполнить запрос. Повторите попытку.', fields: {} };
  }
  return {
    summary: error.problem.detail,
    fields: Object.fromEntries(
      (error.problem.fieldErrors ?? []).map((field) => [field.field, field.message]),
    ),
  };
}
