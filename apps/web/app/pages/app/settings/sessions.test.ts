import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadMe: vi.fn(),
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeAllSessions: vi.fn(),
  navigateTo: vi.fn(),
}));

vi.mock('../../../composables/useAuth.js', () => ({
  useAuth: () => ({
    loadMe: mocks.loadMe,
    listSessions: mocks.listSessions,
    revokeSession: mocks.revokeSession,
    revokeAllSessions: mocks.revokeAllSessions,
  }),
}));

// '#imports' is aliased in vitest.config.ts to apps/web/app/test/nuxt-imports.ts,
// which already stubs definePageMeta/navigateTo — override just navigateTo here
// so its calls are inspectable, keeping every other stub from that file intact.
vi.mock('#imports', async () => {
  const actual = await vi.importActual<typeof import('#imports')>('#imports');
  return { ...actual, navigateTo: mocks.navigateTo };
});

import SessionsSettingsPage from './sessions.vue';

const sessions = [
  {
    id: 'session-1',
    createdAt: '2026-09-01T10:00:00.000Z',
    lastSeenAt: '2026-09-19T09:00:00.000Z',
    idleExpiresAt: '2026-09-20T09:00:00.000Z',
    absoluteExpiresAt: '2026-10-01T10:00:00.000Z',
    userAgent: 'Chrome on Windows',
  },
];

function mountPage() {
  // attachTo: document.body is required for the real (unstubbed) UiConfirmDialog's
  // <dialog> element to receive its method="dialog" submit in jsdom — see
  // ConfirmDialog.test.ts, which needs the same attachment for its own dialog assertions.
  return mount(SessionsSettingsPage, {
    attachTo: document.body,
    global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
  });
}

describe('settings sessions page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSessions.mockResolvedValue(sessions);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('lists sessions with device info', async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('Chrome on Windows');
  });

  it('revoking a session that is not the current one reloads the list without navigating away', async () => {
    mocks.revokeSession.mockResolvedValue(undefined);
    mocks.loadMe.mockResolvedValue({});
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('button[data-action="revoke-session"]').trigger('click');
    await flushPromises();

    expect(mocks.revokeSession).toHaveBeenCalledWith('session-1');
    expect(mocks.listSessions).toHaveBeenCalledTimes(2);
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });

  it('revoking the current session redirects to login', async () => {
    mocks.revokeSession.mockResolvedValue(undefined);
    mocks.loadMe.mockRejectedValue(new Error('unauthorized'));
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('button[data-action="revoke-session"]').trigger('click');
    await flushPromises();

    expect(mocks.navigateTo).toHaveBeenCalledWith('/login');
  });

  it('reports a failed single revoke instead of silently stopping the spinner', async () => {
    mocks.revokeSession.mockRejectedValue(new Error('network down'));
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('button[data-action="revoke-session"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Не удалось завершить сессию. Повторите попытку.');
    expect(mocks.navigateTo).not.toHaveBeenCalled();
    // The unrevoked session must stay visible.
    expect(wrapper.text()).toContain('Chrome on Windows');
  });

  it('reports a failed "sign out everywhere" and stays on the page', async () => {
    mocks.revokeAllSessions.mockRejectedValue(new Error('network down'));
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-action="revoke-all"]').trigger('click');
    await wrapper.get('[data-confirm]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Не удалось выйти отовсюду. Повторите попытку.');
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });

  it('confirming "sign out everywhere" revokes all sessions and redirects to login', async () => {
    mocks.revokeAllSessions.mockResolvedValue(undefined);
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-action="revoke-all"]').trigger('click');
    await wrapper.get('[data-confirm]').trigger('click');
    await flushPromises();

    expect(mocks.revokeAllSessions).toHaveBeenCalled();
    expect(mocks.navigateTo).toHaveBeenCalledWith('/login');
  });
});
