import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  navigateTo: vi.fn(),
  loadDocuments: vi.fn(),
}));

vi.mock('#app', () => ({ navigateTo: mocks.navigateTo }));
vi.mock('../composables/useAuth.js', async () => {
  const actual = await vi.importActual<typeof import('../composables/useAuth.js')>(
    '../composables/useAuth.js',
  );
  return { ...actual, useAuth: () => ({ register: mocks.register }) };
});
vi.mock('../composables/useLegal.js', () => ({
  useLegal: () => ({ loadDocuments: mocks.loadDocuments }),
}));

import AuthForm from '../components/auth/AuthForm.vue';
import RegisterPage from './register.vue';

const documents = [
  { document: 'TERMS', version: '2026-10-18', effectiveOn: '2026-10-18' },
  { document: 'PRIVACY_POLICY', version: '2026-10-18', effectiveOn: '2026-10-18' },
  { document: 'PD_CONSENT', version: '2026-10-18', effectiveOn: '2026-10-18' },
];

function mountPage() {
  return mount(RegisterPage, {
    global: {
      components: { AuthForm },
      stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });
}

describe('register page', () => {
  beforeEach(() => {
    mocks.register.mockReset().mockResolvedValue({ user: { id: 'u1' } });
    mocks.navigateTo.mockReset();
    mocks.loadDocuments.mockReset().mockResolvedValue(documents);
  });

  it('keeps the submit disabled until both consents are checked', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const submit = () => wrapper.get('button[type="submit"]');

    expect(submit().attributes('disabled')).toBeDefined();
    await wrapper.get('[name="consent-terms"]').setValue(true);
    expect(submit().attributes('disabled')).toBeDefined();
    await wrapper.get('[name="consent-pd"]').setValue(true);
    expect(submit().attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).not.toContain('отметьте оба пункта');
  });

  it('sends the current document versions with the registration', async () => {
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('#email').setValue('user@harmofin.test');
    await wrapper.get('#password').setValue('correct-password-10');
    await wrapper.get('[name="consent-terms"]').setValue(true);
    await wrapper.get('[name="consent-pd"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.register).toHaveBeenCalledWith({
      email: 'user@harmofin.test',
      password: 'correct-password-10',
      consents: [
        { document: 'TERMS', version: '2026-10-18' },
        { document: 'PRIVACY_POLICY', version: '2026-10-18' },
        { document: 'PD_CONSENT', version: '2026-10-18' },
      ],
    });
    expect(mocks.navigateTo).toHaveBeenCalledWith('/app');
  });

  it('does not register when the document versions failed to load', async () => {
    mocks.loadDocuments.mockRejectedValue(new Error('offline'));
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[name="consent-terms"]').setValue(true);
    await wrapper.get('[name="consent-pd"]').setValue(true);

    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Не удалось загрузить документы');
  });
});
