import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';

describe('AuthRateLimitGuard', () => {
  it('blocks login after configured number of requests in a window', () => {
    const guard = new AuthRateLimitGuard({
      rateLimit: { windowSeconds: 900, loginMax: 2, recoveryMax: 1 },
    } as never);
    const context = contextFor({ method: 'POST', url: '/api/v1/auth/login', ip: '127.0.0.1' });

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expectRateLimited(() => guard.canActivate(context));
  });

  it('uses a separate, stricter counter for recovery requests', () => {
    const guard = new AuthRateLimitGuard({
      rateLimit: { windowSeconds: 900, loginMax: 2, recoveryMax: 1 },
    } as never);
    const context = contextFor({
      method: 'POST',
      url: '/api/v1/auth/recovery/request',
      ip: '127.0.0.1',
    });

    expect(guard.canActivate(context)).toBe(true);
    expectRateLimited(() => guard.canActivate(context));
  });

  it('limits account restore attempts with the recovery budget', () => {
    const guard = new AuthRateLimitGuard({
      rateLimit: { windowSeconds: 900, loginMax: 5, recoveryMax: 1 },
    } as never);
    const context = contextFor({
      method: 'POST',
      url: '/api/v1/auth/deletion/cancel',
      ip: '127.0.0.1',
    });

    expect(guard.canActivate(context)).toBe(true);
    expectRateLimited(() => guard.canActivate(context));
  });

  it('limits invitation preview and accept with the recovery budget', () => {
    const guard = new AuthRateLimitGuard({
      rateLimit: { windowSeconds: 900, loginMax: 5, recoveryMax: 1 },
    } as never);
    const preview = contextFor({
      method: 'POST',
      url: '/api/v1/invitations/preview',
      ip: '127.0.0.1',
    });
    expect(guard.canActivate(preview)).toBe(true);
    expectRateLimited(() => guard.canActivate(preview));

    const accept = contextFor({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      ip: '127.0.0.1',
    });
    expect(guard.canActivate(accept)).toBe(true);
    expectRateLimited(() => guard.canActivate(accept));
  });

  it('limits email verification confirm and unsubscribe with the recovery budget', () => {
    const guard = new AuthRateLimitGuard({
      rateLimit: { windowSeconds: 900, loginMax: 10, recoveryMax: 5 },
    } as never);
    const confirm = contextFor({
      method: 'POST',
      url: '/api/v1/auth/email-verification/confirm',
      ip: '127.0.0.1',
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(guard.canActivate(confirm)).toBe(true);
    }
    expectRateLimited(() => guard.canActivate(confirm));

    const unsubscribe = contextFor({
      method: 'POST',
      url: '/api/v1/notifications/unsubscribe',
      ip: '127.0.0.1',
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(guard.canActivate(unsubscribe)).toBe(true);
    }
    expectRateLimited(() => guard.canActivate(unsubscribe));
  });

  it('limits creating and resending workspace invitations with the login budget, but not listing', () => {
    const guard = new AuthRateLimitGuard({
      rateLimit: { windowSeconds: 900, loginMax: 1, recoveryMax: 1 },
    } as never);
    const workspaceId = '11111111-1111-1111-1111-111111111111';
    const invitationId = '22222222-2222-2222-2222-222222222222';
    const create = contextFor({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invitations`,
      ip: '127.0.0.1',
    });
    const resend = contextFor({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/invitations/${invitationId}/resend`,
      ip: '127.0.0.1',
    });

    expect(guard.canActivate(create)).toBe(true);
    expectRateLimited(() => guard.canActivate(create));
    expect(guard.canActivate(resend)).toBe(true);
    expectRateLimited(() => guard.canActivate(resend));

    const list = contextFor({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/invitations`,
      ip: '127.0.0.1',
    });
    expect(guard.canActivate(list)).toBe(true);
    expect(guard.canActivate(list)).toBe(true);
    expect(guard.canActivate(list)).toBe(true);
  });
});

function contextFor(request: object): never {
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

function expectRateLimited(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    return;
  }
  throw new Error('Expected rate-limit error');
}
