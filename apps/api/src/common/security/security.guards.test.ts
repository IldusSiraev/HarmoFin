import { createHmac } from 'node:crypto';

import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { CsrfGuard } from './csrf.guard.js';
import { OriginGuard } from './origin.guard.js';

const config = {
  nodeEnv: 'test' as const,
  apiPort: 3001,
  databaseUrl: 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
  webOrigin: 'http://localhost:3000',
  logLevel: 'silent' as const,
  trustProxy: false,
  releaseSha: 'test',
  auth: {
    tokenHashSecret: 'test-only-secret-with-at-least-32-bytes',
    idleTimeoutSeconds: 2_592_000,
    absoluteTimeoutSeconds: 7_776_000,
    recoveryTtlSeconds: 3_600,
    cookieName: 'harmofin_session',
  },
  mail: {
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    from: 'no-reply@harmofin.test',
    webBaseUrl: 'http://localhost:3000',
  },
  rateLimit: { windowSeconds: 900, loginMax: 10, recoveryMax: 5 },
};

describe('OriginGuard', () => {
  it('allows safe requests without an Origin header', () => {
    expect(new OriginGuard(config).canActivate(contextFor({ method: 'GET', headers: {} }))).toBe(
      true,
    );
  });

  it('allows unsafe requests from configured origin', () => {
    expect(
      new OriginGuard(config).canActivate(
        contextFor({ method: 'POST', headers: { origin: config.webOrigin } }),
      ),
    ).toBe(true);
  });

  it('rejects unsafe requests with missing or foreign Origin', () => {
    const guard = new OriginGuard(config);

    expectForbiddenCode(
      () => guard.canActivate(contextFor({ method: 'POST', headers: {} })),
      'ORIGIN_REQUIRED',
    );
    expectForbiddenCode(
      () =>
        guard.canActivate(
          contextFor({ method: 'DELETE', headers: { origin: 'https://evil.example' } }),
        ),
      'ORIGIN_REQUIRED',
    );
  });
});

describe('CsrfGuard', () => {
  const rawToken = 'csrf-token';
  const csrfTokenHash = createHmac('sha256', config.auth.tokenHashSecret)
    .update(rawToken)
    .digest('hex');

  it('allows safe requests without a CSRF token', () => {
    expect(
      new CsrfGuard(config).canActivate(
        contextFor({ method: 'GET', headers: {}, authContext: { csrfTokenHash } }),
      ),
    ).resolves.toBe(true);
  });

  it('allows unsafe requests with matching CSRF token', async () => {
    await expect(
      new CsrfGuard(config).canActivate(
        contextFor({
          method: 'POST',
          headers: { 'x-csrf-token': rawToken },
          authContext: { csrfTokenHash },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('rejects missing and mismatched CSRF tokens', async () => {
    const guard = new CsrfGuard(config);

    await expectForbiddenCodeAsync(
      guard.canActivate(
        contextFor({ method: 'PATCH', headers: {}, authContext: { csrfTokenHash } }),
      ),
      'CSRF_INVALID',
    );
    await expectForbiddenCodeAsync(
      guard.canActivate(
        contextFor({
          method: 'DELETE',
          headers: { 'x-csrf-token': 'wrong-token' },
          authContext: { csrfTokenHash },
        }),
      ),
      'CSRF_INVALID',
    );
  });
});

function contextFor(request: object): never {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

function expectForbiddenCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({ code });
    return;
  }

  throw new Error('Expected ForbiddenException');
}

async function expectForbiddenCodeAsync(action: Promise<unknown>, code: string): Promise<void> {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({ code });
    return;
  }

  throw new Error('Expected ForbiddenException');
}
