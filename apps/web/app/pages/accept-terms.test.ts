import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../composables/useApiClient.js';

const mocks = vi.hoisted(() => ({
  currentData: { value: null as unknown },
  loadMe: vi.fn(),
  acceptConsents: vi.fn(),
  logout: vi.fn(),
  navigateTo: vi.fn(),
  loadDocuments: vi.fn(),
}));

vi.mock('#imports', () => ({ definePageMeta: () => undefined, navigateTo: mocks.navigateTo }));
vi.mock('../composables/useAuth.js', async () => {
  const actual = await vi.importActual<typeof import('../composables/useAuth.js')>(
    '../composables/useAuth.js',
  );
  return {
    ...actual,
    useAuth: () => ({
      currentData: mocks.currentData,
      loadMe: mocks.loadMe,
      acceptConsents: mocks.acceptConsents,
      logout: mocks.logout,
    }),
  };
});
vi.mock('../composables/useLegal.js', () => ({
  useLegal: () => ({ loadDocuments: mocks.loadDocuments }),
}));

import AuthForm from '../components/auth/AuthForm.vue';
import AcceptTermsPage from './accept-terms.vue';

const pending = [{ document: 'TERMS', version: '2026-10-18' }];
const documents = [
  { document: 'TERMS', version: '2026-10-18', effectiveOn: '2026-10-18' },
  { document: 'PRIVACY_POLICY', version: '2026-10-18', effectiveOn: '2026-10-18' },
  { document: 'PD_CONSENT', version: '2026-10-18', effectiveOn: '2026-10-18' },
];

function mountPage() {
  return mount(AcceptTermsPage, {
    global: {
      components: { AuthForm },
      stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });
}

async function checkBoth(wrapper: ReturnType<typeof mountPage>) {
  await wrapper.get('[name="consent-terms"]').setValue(true);
  await wrapper.get('[name="consent-pd"]').setValue(true);
}

describe('accept terms page', () => {
  beforeEach(() => {
    mocks.currentData.value = { user: {}, workspaces: [], pendingConsents: pending };
    mocks.loadMe.mockReset();
    mocks.acceptConsents.mockReset().mockResolvedValue(undefined);
    mocks.logout.mockReset().mockResolvedValue(undefined);
    mocks.navigateTo.mockReset();
    mocks.loadDocuments.mockReset().mockResolvedValue(documents);
  });

  it('accepts the full current set and continues to the app', async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();

    await checkBoth(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.acceptConsents).toHaveBeenCalledWith([
      { document: 'TERMS', version: '2026-10-18' },
      { document: 'PRIVACY_POLICY', version: '2026-10-18' },
      { document: 'PD_CONSENT', version: '2026-10-18' },
    ]);
    expect(mocks.navigateTo).toHaveBeenCalledWith('/app', { replace: true });
  });

  it('shows the server message when the editions moved on', async () => {
    mocks.acceptConsents.mockRejectedValue(
      new ApiRequestError(422, {
        code: 'LEGAL_CONSENT_VERSION_MISMATCH',
        detail: 'Документы обновились. Обновите страницу и примите актуальные редакции.',
      }),
    );
    const wrapper = mountPage();
    await flushPromises();
    await checkBoth(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Документы обновились');
    expect(mocks.navigateTo).not.toHaveBeenCalledWith('/app', { replace: true });
  });

  it('leaves the screen when nothing is pending', async () => {
    mocks.currentData.value = { user: {}, workspaces: [], pendingConsents: [] };
    mountPage();
    await flushPromises();

    expect(mocks.navigateTo).toHaveBeenCalledWith('/app', { replace: true });
  });

  it('shows a hint while unchecked and hides it once both are checked', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Чтобы продолжить, отметьте оба пункта.');
    await checkBoth(wrapper);
    expect(wrapper.text()).not.toContain('Чтобы продолжить, отметьте оба пункта.');
  });

  it('offers account deletion and sign-out instead of accepting', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('a[href="/app/settings/delete-account"]').exists()).toBe(true);
    await wrapper.get('button.form-links__button').trigger('click');
    await flushPromises();
    expect(mocks.logout).toHaveBeenCalled();
    expect(mocks.navigateTo).toHaveBeenCalledWith('/login', { replace: true });
  });
});
