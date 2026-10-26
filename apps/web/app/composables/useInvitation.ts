import { useApiClient } from './useApiClient.js';

export type InvitationPreview = {
  workspaceName: string;
  inviterName: string;
  role: 'EDITOR' | 'VIEWER';
  maskedEmail: string;
  expiresAt: string;
};

export const INVITE_TOKEN_KEY = 'harmofin-invite-token';

// Shared between /invite and the registration page: a stored token that hit
// one of these codes cannot lead anywhere else, so both places drop it
// instead of keeping it around for a retry that would only repeat the error.
export const INVITATION_TERMINAL_ERROR_CODES: ReadonlySet<string> = new Set([
  'INVITATION_EXPIRED',
  'INVITATION_REVOKED',
  'INVITATION_ALREADY_ACCEPTED',
  'INVITATION_NOT_FOUND',
  'ALREADY_MEMBER',
]);

// Charset only, no length bound: the server schema (16-128 chars) is the
// actual validation boundary. This just rejects a hash that is not a token
// (stray fragment, anchor link) before spending a network round trip on it.
export function readTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token && /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

export function useInvitation() {
  const api = useApiClient();
  return {
    readTokenFromHash,
    preview: (token: string) =>
      api.request<InvitationPreview>('/api/v1/invitations/preview', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    accept: (token: string, displayName?: string) =>
      api.request<{ workspaceId: string; budgetId: string }>('/api/v1/invitations/accept', {
        method: 'POST',
        body: JSON.stringify(displayName ? { token, displayName } : { token }),
      }),
  };
}
