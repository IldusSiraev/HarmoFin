import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), requestBlob: vi.fn() }));

vi.mock('../../composables/useApiClient.js', async () => {
  const actual = await vi.importActual<typeof import('../../composables/useApiClient.js')>(
    '../../composables/useApiClient.js',
  );
  return { ...actual, useApiClient: () => mocks };
});

import { ApiRequestError } from '../../composables/useApiClient.js';
import LandingHeader from './LandingHeader.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};

const mountHeader = () => mount(LandingHeader, { global: { stubs: { NuxtLink: NuxtLinkStub } } });

const signedIn = () =>
  mocks.request.mockResolvedValue({
    user: { id: 'user-1', email: 'owner@example.com', displayName: null },
    workspaces: [],
    pendingConsents: [],
  });

const signedOut = () =>
  mocks.request.mockRejectedValue(
    new ApiRequestError(401, { code: 'UNAUTHENTICATED', detail: 'Требуется вход.' }),
  );

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  await nextTick();
}

const actionHrefs = (wrapper: ReturnType<typeof mountHeader>, selector: string) =>
  wrapper
    .get(selector)
    .findAll('a')
    .map((link) => link.attributes('href'));

describe('LandingHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedOut();
  });

  it('renders anchor navigation and both call-to-action links', () => {
    const wrapper = mountHeader();

    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '#features',
        '#how-it-works',
        '#security',
        '#faq',
        '/login',
        '/register',
      ]),
    );
  });

  it('toggles the mobile menu and reports its state', async () => {
    const wrapper = mountHeader();
    const toggle = wrapper.get('[data-testid="landing-menu-toggle"]');

    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(toggle.attributes('aria-controls')).toBe('landing-mobile-menu');
    expect(wrapper.find('#landing-mobile-menu').exists()).toBe(false);

    await toggle.trigger('click');

    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('#landing-mobile-menu').isVisible()).toBe(true);

    await toggle.trigger('click');

    expect(toggle.attributes('aria-expanded')).toBe('false');
  });

  it('closes the mobile menu when a navigation link is used', async () => {
    const wrapper = mountHeader();
    await wrapper.get('[data-testid="landing-menu-toggle"]').trigger('click');

    await wrapper.get('#landing-mobile-menu a').trigger('click');

    expect(wrapper.get('[data-testid="landing-menu-toggle"]').attributes('aria-expanded')).toBe(
      'false',
    );
  });

  it('closes the mobile menu when Escape is pressed', async () => {
    const wrapper = mountHeader();
    await wrapper.get('[data-testid="landing-menu-toggle"]').trigger('click');
    expect(wrapper.get('#landing-mobile-menu').isVisible()).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="landing-menu-toggle"]').attributes('aria-expanded')).toBe(
      'false',
    );
    expect(wrapper.find('#landing-mobile-menu').exists()).toBe(false);
  });

  it('shows sign-in and registration to a guest on desktop and in the mobile menu', async () => {
    const wrapper = mountHeader();
    await settle();

    expect(actionHrefs(wrapper, '.landing-header__actions')).toEqual(['/login', '/register']);
    expect(wrapper.text()).not.toContain('Открыть приложение');

    await wrapper.get('[data-testid="landing-menu-toggle"]').trigger('click');
    expect(actionHrefs(wrapper, '#landing-mobile-menu')).toEqual(
      expect.arrayContaining(['/login', '/register']),
    );
    expect(actionHrefs(wrapper, '#landing-mobile-menu')).not.toContain('/app');
  });

  it('shows a single link into the app to a signed-in user on desktop and in the mobile menu', async () => {
    signedIn();
    const wrapper = mountHeader();
    await settle();

    expect(actionHrefs(wrapper, '.landing-header__actions')).toEqual(['/app']);
    expect(wrapper.get('.landing-header__actions').text()).toBe('Открыть приложение');

    await wrapper.get('[data-testid="landing-menu-toggle"]').trigger('click');
    const mobileHrefs = actionHrefs(wrapper, '#landing-mobile-menu');
    expect(mobileHrefs).toContain('/app');
    expect(mobileHrefs).not.toContain('/login');
    expect(mobileHrefs).not.toContain('/register');
  });

  it('keeps the account actions hidden while the session is being checked', () => {
    mocks.request.mockReturnValue(new Promise(() => {}));
    const wrapper = mountHeader();

    const actions = wrapper.get('.landing-header__actions');
    expect(actions.classes()).toContain('landing-header__actions--pending');
    expect(actions.attributes('aria-hidden')).toBe('true');
    expect(wrapper.text()).not.toContain('Открыть приложение');
  });
});
