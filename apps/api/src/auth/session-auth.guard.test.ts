import { describe, expect, it, vi } from 'vitest';

import { SessionAuthGuard } from './session-auth.guard.js';

describe('SessionAuthGuard', () => {
  const authenticate = vi.fn();
  const guard = new SessionAuthGuard(
    { authenticate },
    { auth: { cookieName: 'harmofin_session' } } as never,
  );

  it('rejects when session cookie is missing', async () => {
    await expect(guard.canActivate(contextFor({ cookies: {} }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SESSION_REQUIRED' }),
    });
  });

  it('rejects invalid sessions without adding context', async () => {
    authenticate.mockResolvedValueOnce(null);
    const request = { cookies: { harmofin_session: 'raw-cookie' } };

    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SESSION_INVALID' }),
    });
    expect(request).not.toHaveProperty('authContext');
  });

  it('adds only safe session context after authentication', async () => {
    authenticate.mockResolvedValueOnce({ userId: 'user', sessionId: 'session', csrfTokenHash: 'digest' });
    const request = { cookies: { harmofin_session: 'raw-cookie' } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request).toHaveProperty('authContext', { userId: 'user', sessionId: 'session', csrfTokenHash: 'digest' });
    expect((request as { authContext?: unknown }).authContext).not.toHaveProperty('rawToken');
  });
});

function contextFor(request: object): never {
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}
