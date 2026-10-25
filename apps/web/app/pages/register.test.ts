import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  navigateTo: vi.fn(),
  loadDocuments: vi.fn(),
  route: { query: {} as Record<string, string> },
}));

vi.mock('#app', () => ({ navigateTo: mocks.navigateTo, useRoute: () => mocks.route }));
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
    mocks.route.query = {};
    sessionStorage.clear();
  });

  it('keeps the submit disabled until both consents are checked', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const submit = () => wrapper.get('button[type="submit"]');

    expect(submit().attributes('disabled')).toBeDefined();
    expect(submit().attributes('aria-describedby')).toBe('consent-hint');
    await wrapper.get('[name="consent-terms"]').setValue(true);
    expect(submit().attributes('disabled')).toBeDefined();
    await wrapper.get('[name="consent-pd"]').setValue(true);
    expect(submit().attributes('disabled')).toBeUndefined();
    expect(submit().attributes('aria-describedby')).toBeUndefined();
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

  it('links the password hint and asks only for an optional budget name', async () => {
    const wrapper = mountPage();
    await flushPromises();

    const password = wrapper.get('#password');
    expect(password.attributes('aria-describedby')).toBe('password-hint');
    expect(wrapper.get('#password-hint').text()).toBe('Минимум 10 символов.');
    expect(password.attributes('minlength')).toBe('10');
    expect(wrapper.find('#workspace').exists()).toBe(false);
    expect(wrapper.get('#budget').attributes('maxlength')).toBe('120');
  });

  it('sends the budget name when provided', async () => {
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('#email').setValue('user@harmofin.test');
    await wrapper.get('#password').setValue('correct-password-10');
    await wrapper.get('#budget').setValue('Семья Ивановых');
    await wrapper.get('[name="consent-terms"]').setValue(true);
    await wrapper.get('[name="consent-pd"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({ budgetName: 'Семья Ивановых' }),
    );
    expect(mocks.register.mock.calls[0]?.[0]).not.toHaveProperty('workspaceName');
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

  describe('opened from an invitation', () => {
    beforeEach(() => {
      mocks.route.query = { invite: '1' };
      sessionStorage.setItem('harmofin-invite-token', 'invite-token-value');
    });

    it('hides the budget name field and sends the invitation token instead', async () => {
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find('#budget').exists()).toBe(false);
      await wrapper.get('#email').setValue('user@harmofin.test');
      await wrapper.get('#password').setValue('correct-password-10');
      await wrapper.get('[name="consent-terms"]').setValue(true);
      await wrapper.get('[name="consent-pd"]').setValue(true);
      await wrapper.get('form').trigger('submit');
      await flushPromises();

      expect(mocks.register).toHaveBeenCalledWith(
        expect.objectContaining({ invitationToken: 'invite-token-value' }),
      );
      expect(mocks.register.mock.calls[0]?.[0]).not.toHaveProperty('budgetName');
    });

    it('clears the stored token and goes to /invite to ask for a name after success', async () => {
      const wrapper = mountPage();
      await flushPromises();
      await wrapper.get('#email').setValue('user@harmofin.test');
      await wrapper.get('#password').setValue('correct-password-10');
      await wrapper.get('[name="consent-terms"]').setValue(true);
      await wrapper.get('[name="consent-pd"]').setValue(true);
      await wrapper.get('form').trigger('submit');
      await flushPromises();

      expect(sessionStorage.getItem('harmofin-invite-token')).toBeNull();
      expect(mocks.navigateTo).toHaveBeenCalledWith('/invite?welcome=1');
    });

    it('shows the email field error on an email mismatch', async () => {
      const { ApiRequestError } = await import('../composables/useApiClient.js');
      mocks.register.mockRejectedValue(
        new ApiRequestError(403, {
          code: 'INVITATION_EMAIL_MISMATCH',
          detail: 'Приглашение отправлено на другой email.',
        }),
      );
      const wrapper = mountPage();
      await flushPromises();
      await wrapper.get('#email').setValue('wrong@harmofin.test');
      await wrapper.get('#password').setValue('correct-password-10');
      await wrapper.get('[name="consent-terms"]').setValue(true);
      await wrapper.get('[name="consent-pd"]').setValue(true);
      await wrapper.get('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('Приглашение отправлено на другой адрес');
      expect(mocks.navigateTo).not.toHaveBeenCalledWith('/invite?welcome=1');
    });

    it('drops the token and falls back to a normal registration after a terminal invitation error', async () => {
      const { ApiRequestError } = await import('../composables/useApiClient.js');
      mocks.register.mockRejectedValueOnce(
        new ApiRequestError(410, {
          code: 'INVITATION_EXPIRED',
          detail: 'Приглашение истекло.',
        }),
      );
      const wrapper = mountPage();
      await flushPromises();
      await wrapper.get('#email').setValue('user@harmofin.test');
      await wrapper.get('#password').setValue('correct-password-10');
      await wrapper.get('[name="consent-terms"]').setValue(true);
      await wrapper.get('[name="consent-pd"]').setValue(true);
      await wrapper.get('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('Приглашение истекло.');
      expect(sessionStorage.getItem('harmofin-invite-token')).toBeNull();
      expect(wrapper.find('#budget').exists()).toBe(true);

      mocks.register.mockResolvedValueOnce({ user: { id: 'u1' } });
      await wrapper.get('form').trigger('submit');
      await flushPromises();

      expect(mocks.register.mock.calls[1]?.[0]).not.toHaveProperty('invitationToken');
      expect(mocks.navigateTo).toHaveBeenCalledWith('/app');
    });

    it('keeps the token and the invite-mode form when the family is full', async () => {
      const { ApiRequestError } = await import('../composables/useApiClient.js');
      mocks.register.mockRejectedValueOnce(
        new ApiRequestError(409, {
          code: 'MEMBER_LIMIT_REACHED',
          detail: 'В семье достигнут лимит участников.',
        }),
      );
      const wrapper = mountPage();
      await flushPromises();
      await wrapper.get('#email').setValue('user@harmofin.test');
      await wrapper.get('#password').setValue('correct-password-10');
      await wrapper.get('[name="consent-terms"]').setValue(true);
      await wrapper.get('[name="consent-pd"]').setValue(true);
      await wrapper.get('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain(
        'В семье уже 10 участников. Попросите создателя освободить место и попробуйте снова.',
      );
      expect(sessionStorage.getItem('harmofin-invite-token')).toBe('invite-token-value');
      expect(wrapper.find('#budget').exists()).toBe(false);

      mocks.register.mockResolvedValueOnce({ user: { id: 'u1' } });
      await wrapper.get('form').trigger('submit');
      await flushPromises();

      expect(mocks.register.mock.calls[1]?.[0]).toMatchObject({
        invitationToken: 'invite-token-value',
      });
      expect(mocks.navigateTo).toHaveBeenCalledWith('/invite?welcome=1');
    });
  });
});
