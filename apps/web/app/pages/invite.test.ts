import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../composables/useApiClient.js';

type CurrentUser = { id: string; email: string; displayName: string | null };
type Workspace = { id: string; name: string };

const mocks = vi.hoisted(() => ({
  route: { query: {} as Record<string, string>, hash: '' },
  routerReplace: vi.fn(),
  navigateTo: vi.fn(),
  reloadNuxtApp: vi.fn(),
  loadMe: vi.fn(),
  logout: vi.fn(),
  updateProfile: vi.fn(),
  currentUser: { value: null } as { value: CurrentUser | null },
  workspace: { value: null } as { value: Workspace | null },
  preview: vi.fn(),
  accept: vi.fn(),
}));

vi.mock('#app', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ replace: mocks.routerReplace }),
  navigateTo: mocks.navigateTo,
  reloadNuxtApp: mocks.reloadNuxtApp,
}));

vi.mock('../composables/useAuth.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAuth: () => ({
    currentUser: mocks.currentUser,
    loadMe: mocks.loadMe,
    logout: mocks.logout,
    updateProfile: mocks.updateProfile,
  }),
}));

vi.mock('../composables/useActiveWorkspace.js', () => ({
  useActiveWorkspace: () => ({ workspace: mocks.workspace }),
}));

vi.mock('../composables/useInvitation.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useInvitation: () => ({ preview: mocks.preview, accept: mocks.accept }),
}));

import InvitePage from './invite.vue';

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

const wrappers: Array<{ unmount: () => void }> = [];
function mountPage() {
  const wrapper = mount(InvitePage, { attachTo: document.body, global: { stubs } });
  wrappers.push(wrapper);
  return wrapper;
}

const invitationPreview = {
  workspaceName: 'Сираевы',
  inviterName: 'Ильдар',
  role: 'EDITOR' as const,
  maskedEmail: 'i***@example.com',
  expiresAt: '2026-11-01T00:00:00.000Z',
};

describe('invite page', () => {
  beforeEach(() => {
    mocks.route.query = {};
    mocks.route.hash = '';
    mocks.routerReplace.mockReset().mockImplementation(({ hash }: { hash: string }) => {
      mocks.route.hash = hash;
      return Promise.resolve();
    });
    mocks.navigateTo.mockReset();
    mocks.reloadNuxtApp.mockReset().mockResolvedValue(undefined);
    mocks.loadMe.mockReset();
    mocks.logout.mockReset().mockResolvedValue(undefined);
    mocks.updateProfile.mockReset().mockResolvedValue(undefined);
    mocks.currentUser.value = null;
    mocks.workspace.value = null;
    mocks.preview.mockReset();
    mocks.accept.mockReset();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/invite');
  });

  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  });

  it('shows a loading message while checking the invitation', async () => {
    sessionStorage.setItem('harmofin-invite-token', 'a-valid-invite-token-value');
    mocks.loadMe.mockRejectedValue(new Error('not signed in'));
    let resolvePreview: (value: typeof invitationPreview) => void = () => {};
    mocks.preview.mockReturnValue(new Promise((resolve) => (resolvePreview = resolve)));

    const wrapper = mountPage();
    await Promise.resolve();

    expect(wrapper.text()).toContain('Проверяем приглашение…');
    resolvePreview(invitationPreview);
    await flushPromises();
  });

  it('reads the token from the hash, stores it and strips the hash from the URL', async () => {
    window.history.replaceState(null, '', '/invite#token=a-valid-invite-token-value');
    mocks.loadMe.mockRejectedValue(new Error('not signed in'));
    mocks.preview.mockResolvedValue(invitationPreview);

    mountPage();
    await flushPromises();

    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/invite');
    expect(sessionStorage.getItem('harmofin-invite-token')).toBe('a-valid-invite-token-value');
    expect(mocks.preview).toHaveBeenCalledWith('a-valid-invite-token-value');
  });

  it('shows a link-invalid message when there is no token at all', async () => {
    mocks.loadMe.mockRejectedValue(new Error('not signed in'));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Ссылка недействительна.');
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('clears the hash from the router state too, not just the browser URL', async () => {
    window.history.replaceState(null, '', '/invite#token=a-valid-invite-token-value');
    mocks.route.hash = '#token=a-valid-invite-token-value';
    mocks.loadMe.mockRejectedValue(new Error('not signed in'));
    mocks.preview.mockResolvedValue(invitationPreview);

    mountPage();
    await flushPromises();

    expect(mocks.routerReplace).toHaveBeenCalledWith({ hash: '' });
    expect(mocks.route.hash).toBe('');
  });

  it('treats a malformed hash as no token, without falling back to an older stored token', async () => {
    sessionStorage.setItem('harmofin-invite-token', 'an-older-stored-token-value');
    window.history.replaceState(null, '', '/invite#token=bad%20token');
    mocks.loadMe.mockRejectedValue(new Error('not signed in'));

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain('Ссылка недействительна.');
    expect(sessionStorage.getItem('harmofin-invite-token')).toBeNull();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('moves focus to the heading once loading finishes', async () => {
    sessionStorage.setItem('harmofin-invite-token', 'a-valid-invite-token-value');
    mocks.loadMe.mockRejectedValue(new Error('not signed in'));
    mocks.preview.mockResolvedValue(invitationPreview);

    const wrapper = mountPage();
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.get('#invite-title').element);
  });

  describe('signed out', () => {
    beforeEach(() => {
      sessionStorage.setItem('harmofin-invite-token', 'a-valid-invite-token-value');
      mocks.loadMe.mockRejectedValue(new Error('not signed in'));
      mocks.preview.mockResolvedValue(invitationPreview);
    });

    it('offers to create an account or sign in', async () => {
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).toContain('Ильдар приглашает вас в семью «Сираевы» как участника');
      expect(wrapper.get('a[href="/register?invite=1"]').text()).toContain('Создать аккаунт');
      expect(wrapper.get('a[href="/login?invite=1"]').text()).toContain('Войти');
    });

    it('describes a viewer invitation with the matching wording', async () => {
      mocks.preview.mockResolvedValue({ ...invitationPreview, role: 'VIEWER' });
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).toContain('как наблюдателя');
    });
  });

  describe('signed in', () => {
    beforeEach(() => {
      sessionStorage.setItem('harmofin-invite-token', 'a-valid-invite-token-value');
      mocks.preview.mockResolvedValue(invitationPreview);
    });

    it('asks for a name when the current user has none, then accepts', async () => {
      mocks.currentUser.value = { id: 'u1', email: 'a@b.test', displayName: null };
      mocks.loadMe.mockResolvedValue({});
      mocks.accept.mockResolvedValue({ workspaceId: 'w1', budgetId: 'b1' });
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find('#invite-name').exists()).toBe(true);
      const button = wrapper.get('button');
      expect(button.attributes('disabled')).toBeDefined();
      await wrapper.get('#invite-name').setValue('Анна');
      await button.trigger('click');
      await flushPromises();

      expect(mocks.accept).toHaveBeenCalledWith('a-valid-invite-token-value', 'Анна');
      expect(sessionStorage.getItem('harmofin-invite-token')).toBeNull();
      expect(mocks.reloadNuxtApp).toHaveBeenCalledWith({ path: '/app' });
    });

    it('accepts directly without a name field when the user already has a name', async () => {
      mocks.currentUser.value = { id: 'u1', email: 'a@b.test', displayName: 'Анна' };
      mocks.loadMe.mockResolvedValue({});
      mocks.accept.mockResolvedValue({ workspaceId: 'w1', budgetId: 'b1' });
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find('#invite-name').exists()).toBe(false);
      await wrapper.get('button').trigger('click');
      await flushPromises();

      expect(mocks.accept).toHaveBeenCalledWith('a-valid-invite-token-value', undefined);
      expect(mocks.reloadNuxtApp).toHaveBeenCalledWith({ path: '/app' });
    });
  });

  describe('invitation errors', () => {
    beforeEach(() => {
      sessionStorage.setItem('harmofin-invite-token', 'a-valid-invite-token-value');
      mocks.loadMe.mockRejectedValue(new Error('not signed in'));
    });

    it('shows the expired message and clears the stored token', async () => {
      mocks.preview.mockRejectedValue(
        new ApiRequestError(410, { code: 'INVITATION_EXPIRED', detail: 'Истекло.' }),
      );
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).toContain('Приглашение истекло — попросите отправить новое.');
      expect(sessionStorage.getItem('harmofin-invite-token')).toBeNull();
    });

    it('shows the revoked message', async () => {
      mocks.preview.mockRejectedValue(
        new ApiRequestError(410, { code: 'INVITATION_REVOKED', detail: 'Отозвано.' }),
      );
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).toContain('Приглашение отозвано.');
    });

    it('shows the invalid-link message for a missing invitation', async () => {
      mocks.preview.mockRejectedValue(
        new ApiRequestError(404, { code: 'INVITATION_NOT_FOUND', detail: 'Не найдено.' }),
      );
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).toContain('Ссылка недействительна.');
    });

    it('shows the email mismatch message with a sign-out action', async () => {
      mocks.currentUser.value = { id: 'u1', email: 'a@b.test', displayName: 'Анна' };
      mocks.loadMe.mockResolvedValue({});
      mocks.preview.mockResolvedValue(invitationPreview);
      mocks.accept.mockRejectedValue(
        new ApiRequestError(403, {
          code: 'INVITATION_EMAIL_MISMATCH',
          detail: 'Другой email.',
        }),
      );
      const wrapper = mountPage();
      await flushPromises();
      await wrapper.get('button').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain(
        'Приглашение отправлено на i***@example.com. Войдите под этим адресом.',
      );
      await wrapper.get('button').trigger('click');
      await flushPromises();

      expect(mocks.logout).toHaveBeenCalled();
      expect(mocks.navigateTo).toHaveBeenCalledWith('/login?invite=1');
      // Not a terminal error: the token stays for another attempt after signing in correctly.
      expect(sessionStorage.getItem('harmofin-invite-token')).toBe('a-valid-invite-token-value');
    });

    it('shows the member-limit message and keeps the token so /invite can be retried later', async () => {
      mocks.currentUser.value = { id: 'u1', email: 'a@b.test', displayName: 'Анна' };
      mocks.loadMe.mockResolvedValue({});
      mocks.preview.mockResolvedValue(invitationPreview);
      mocks.accept.mockRejectedValue(
        new ApiRequestError(409, { code: 'MEMBER_LIMIT_REACHED', detail: 'Семья заполнена.' }),
      );
      const wrapper = mountPage();
      await flushPromises();
      await wrapper.get('button').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Семья заполнена.');
      expect(sessionStorage.getItem('harmofin-invite-token')).toBe('a-valid-invite-token-value');
    });

    it('shows the already-a-member message with a link to the app', async () => {
      mocks.currentUser.value = { id: 'u1', email: 'a@b.test', displayName: 'Анна' };
      mocks.loadMe.mockResolvedValue({});
      mocks.preview.mockResolvedValue(invitationPreview);
      mocks.accept.mockRejectedValue(
        new ApiRequestError(409, { code: 'ALREADY_MEMBER', detail: 'Уже участник.' }),
      );
      const wrapper = mountPage();
      await flushPromises();
      await wrapper.get('button').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Вы уже в этой семье.');
      expect(wrapper.get('a[href="/app"]')).toBeTruthy();
      expect(sessionStorage.getItem('harmofin-invite-token')).toBeNull();
    });
  });

  describe('welcome step after registration', () => {
    beforeEach(() => {
      mocks.route.query = { welcome: '1' };
      mocks.workspace.value = { id: 'w1', name: 'Сираевы' };
      mocks.loadMe.mockResolvedValue({});
    });

    it('shows a loading message before the workspace name is known', async () => {
      let resolveLoadMe: (value: unknown) => void = () => {};
      mocks.loadMe.mockReturnValue(new Promise((resolve) => (resolveLoadMe = resolve)));

      const wrapper = mountPage();
      await Promise.resolve();

      expect(wrapper.text()).toContain('Загружаем данные…');
      expect(wrapper.text()).not.toContain('Вы в семье');
      resolveLoadMe(undefined);
      await flushPromises();
    });

    it('asks for a name (same label as the sign-in step) and saves it with a full reload to /app', async () => {
      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).toContain('Вы в семье «Сираевы»');
      expect(wrapper.get('label').text()).toContain('Ваше имя');
      await wrapper.get('#welcome-name').setValue('Анна');
      await wrapper.get('button').trigger('click');
      await flushPromises();

      expect(mocks.updateProfile).toHaveBeenCalledWith('Анна');
      expect(mocks.reloadNuxtApp).toHaveBeenCalledWith({ path: '/app' });
    });
  });
});
