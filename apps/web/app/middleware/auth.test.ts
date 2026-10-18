import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadMe: vi.fn() }));

vi.mock('#app', () => ({
  defineNuxtRouteMiddleware: (fn: unknown) => fn,
  navigateTo: (path: string) => path,
}));
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => ({ loadMe: mocks.loadMe }) }));

import middleware from './auth.js';

const run = middleware as unknown as (to: { path: string }) => Promise<string | undefined>;
const pending = [{ document: 'TERMS', version: '2026-10-18' }];

describe('auth middleware', () => {
  // A fresh vi.fn() per test (rather than mockReset) avoids a Vitest/Node timing
  // artifact where a settled rejected mock call from a prior test can surface as
  // an unhandled rejection in a later test, even though it was caught here.
  beforeEach(() => {
    mocks.loadMe = vi.fn();
  });

  it.each([
    ['/app', pending, '/accept-terms'],
    ['/app/operations', pending, '/accept-terms'],
    ['/accept-terms', pending, undefined],
    ['/app/settings/delete-account', pending, undefined],
    ['/app', [], undefined],
  ])('on %s with pending %j resolves to %s', async (path, pendingConsents, target) => {
    mocks.loadMe.mockResolvedValue({ user: {}, workspaces: [], pendingConsents });
    await expect(run({ path })).resolves.toBe(target);
  });

  it('sends signed-out users to /login', async () => {
    mocks.loadMe.mockRejectedValue(new Error('401'));
    await expect(run({ path: '/app' })).resolves.toBe('/login');
  });
});
