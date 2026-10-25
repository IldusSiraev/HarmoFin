export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MEMBER_LIMIT = 10;
export const PENDING_INVITATION_LIMIT = 20;

export type InvitableRole = 'EDITOR' | 'VIEWER';

export const ROLE_LABELS: Record<'OWNER' | 'EDITOR' | 'VIEWER', string> = {
  OWNER: 'Создатель',
  EDITOR: 'Участник',
  VIEWER: 'Наблюдатель',
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Shows only the first character of the local part: enough to recognize, not to harvest. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = normalizeEmail(email).split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export function invitationExpiresAt(now: Date): Date {
  return new Date(now.getTime() + INVITATION_TTL_MS);
}

export function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** The fragment never reaches the server or proxy logs; the page posts the token in a body. */
export function buildInviteUrl(webBaseUrl: string, rawToken: string): string {
  const url = new URL('/invite', webBaseUrl);
  url.hash = `token=${rawToken}`;
  return url.toString();
}
