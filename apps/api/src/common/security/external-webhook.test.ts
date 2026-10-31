import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ExternalWebhook } from './external-webhook.decorator.js';
import { OriginGuard } from './origin.guard.js';

const config = { webOrigin: 'http://localhost:3000' } as never;

class Handlers {
  @ExternalWebhook()
  webhook(): void {}

  regular(): void {}
}

function contextFor(handler: () => void, headers: Record<string, string> = {}): never {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method: 'POST', headers }) }),
    getHandler: () => handler,
    getClass: () => Handlers,
  } as never;
}

describe('ExternalWebhook', () => {
  it('lets a POST without Origin reach a webhook route', () => {
    const guard = new OriginGuard(config);
    expect(guard.canActivate(contextFor(Handlers.prototype.webhook))).toBe(true);
  });

  it('still rejects a POST without Origin on a regular route', () => {
    const guard = new OriginGuard(config);
    expect(() => guard.canActivate(contextFor(Handlers.prototype.regular))).toThrow(
      ForbiddenException,
    );
  });

  it('still accepts the web origin on a regular route', () => {
    const guard = new OriginGuard(config);
    expect(
      guard.canActivate(
        contextFor(Handlers.prototype.regular, { origin: 'http://localhost:3000' }),
      ),
    ).toBe(true);
  });
});
