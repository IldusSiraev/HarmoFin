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
