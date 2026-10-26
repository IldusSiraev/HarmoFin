import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { ApiRequestError } from '../../../composables/useApiClient.js';

const mocks = {
  members: ref<unknown[]>([]),
  invitations: ref<unknown[]>([]),
  loading: ref(false),
  error: ref<string | null>(null),
  load: vi.fn(),
  invite: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  changeRole: vi.fn(),
  removeMember: vi.fn(),
  leave: vi.fn(),
  isCreator: ref(true),
  workspace: ref<{ id: string } | null>({ id: 'workspace-id' }),
  currentUser: ref<{ id: string; email: string; displayName: string | null } | null>(null),
};

vi.mock('../../../composables/useFamily.js', () => ({
  useFamily: () => ({
    members: mocks.members,
    invitations: mocks.invitations,
    loading: mocks.loading,
    error: mocks.error,
    load: mocks.load,
    invite: mocks.invite,
    resend: mocks.resend,
    revoke: mocks.revoke,
    changeRole: mocks.changeRole,
    removeMember: mocks.removeMember,
    leave: mocks.leave,
  }),
}));

vi.mock('../../../composables/useActiveWorkspace.js', () => ({
  useActiveWorkspace: () => ({ workspace: mocks.workspace, isCreator: mocks.isCreator }),
}));

vi.mock('../../../composables/useAuth.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAuth: () => ({ currentUser: mocks.currentUser, updateProfile: vi.fn() }),
}));

import FamilySettingsPage from './family.vue';

const wrappers: Array<{ unmount: () => void }> = [];

function mountPage() {
  const wrapper = mount(FamilySettingsPage, {
    attachTo: document.body,
    global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } },
  });
  wrappers.push(wrapper);
  return wrapper;
}

const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);
const qa = <T extends HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];

const creator = {
  membershipId: 'm-owner',
  userId: 'u-owner',
  email: 'owner@example.test',
  displayName: 'Иван',
  role: 'OWNER',
  isCreator: true,
  joinedAt: '2026-01-01T00:00:00.000Z',
};

const editorMember = {
  membershipId: 'm-editor',
  userId: 'u-editor',
  email: 'aliya@example.test',
  displayName: 'Алия',
  role: 'EDITOR',
  isCreator: false,
  joinedAt: '2026-01-02T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.members.value = [creator, editorMember];
  mocks.invitations.value = [];
  mocks.loading.value = false;
  mocks.error.value = null;
  mocks.isCreator.value = true;
  mocks.workspace.value = { id: 'workspace-id' };
  mocks.currentUser.value = { id: 'u-owner', email: 'owner@example.test', displayName: 'Иван' };
});

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('settings family page', () => {
  it('shows the profile name card and disables invite for a nameless creator', async () => {
    mocks.currentUser.value = { id: 'u-owner', email: 'owner@example.test', displayName: null };
    mountPage();
    await flushPromises();

    expect(text()).toContain('Укажите ваше имя — его увидят участники');
    const inviteButton = qa<HTMLButtonElement>('button').find(
      (button) => button.textContent?.trim() === 'Пригласить',
    );
    expect(inviteButton?.disabled).toBe(true);
  });

  it('shows the members list with role labels, the invitations card and an active invite button for a named creator', async () => {
    mountPage();
    await flushPromises();

    expect(text()).not.toContain('Укажите ваше имя — его увидят участники');
    expect(text()).toContain('Создатель');
    expect(text()).toContain('Участник');
    expect(text()).toContain('Приглашений нет');
    const inviteButton = qa<HTMLButtonElement>('button').find(
      (button) => button.textContent?.trim() === 'Пригласить',
    );
    expect(inviteButton?.disabled).toBe(false);
  });

  it('shows the action menu for a non-creator row with role and removal actions behind a confirm dialog', async () => {
    mountPage();
    await flushPromises();

    const menuTrigger = q<HTMLButtonElement>('[aria-label="Действия: Алия"]');
    expect(menuTrigger).not.toBeNull();
    menuTrigger!.click();
    await flushPromises();

    const items = qa<HTMLButtonElement>('[role="menuitem"]');
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Сделать наблюдателем',
      'Удалить из семьи',
    ]);

    items[1]!.click();
    await flushPromises();
    expect(text()).toContain('Удалить участника?');
  });

  it('shows no action menu for the creator row', async () => {
    mountPage();
    await flushPromises();

    expect(q('[aria-label="Действия: Иван"]')).toBeNull();
  });

  it('shows a read-only view with a confirmed leave action for an editor', async () => {
    mocks.isCreator.value = false;
    mountPage();
    await flushPromises();

    expect(q('[data-action="leave-family"]')).not.toBeNull();
    expect(
      qa<HTMLButtonElement>('button').some((b) => b.textContent?.trim() === 'Пригласить'),
    ).toBe(false);
    expect(text()).not.toContain('Приглашений нет');

    q<HTMLButtonElement>('[data-action="leave-family"]')?.click();
    await flushPromises();
    expect(text()).toContain('Выйти из семьи?');
  });

  it('shows the sent state with the invite link and no toast after a successful invite', async () => {
    mocks.invite.mockResolvedValue({
      id: 'inv-1',
      email: 'friend@example.test',
      role: 'EDITOR',
      status: 'PENDING',
      expiresAt: '2026-11-01T00:00:00.000Z',
      createdAt: '2026-10-25T00:00:00.000Z',
      inviteUrl: 'https://harmofin.test/invite/abc',
    });
    mountPage();
    await flushPromises();

    const inviteButton = qa<HTMLButtonElement>('button').find(
      (button) => button.textContent?.trim() === 'Пригласить',
    );
    inviteButton?.click();
    await flushPromises();

    const emailInput = q<HTMLInputElement>('input[name="email"]');
    emailInput!.value = 'friend@example.test';
    emailInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    q<HTMLFormElement>('[role="dialog"] form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await flushPromises();

    expect(text()).toContain('Письмо отправлено на friend@example.test');
    expect(q('input[name="inviteUrl"]')).not.toBeNull();
    expect(text()).toContain('Копировать');
    expect(text()).toContain('Ссылка показывается один раз');
    expect(document.querySelector('[data-testid="toast"]')).toBeNull();
  });

  it('shows INVITATION_ALREADY_PENDING and ALREADY_MEMBER errors at the email field', async () => {
    mountPage();
    await flushPromises();
    const inviteButton = qa<HTMLButtonElement>('button').find(
      (button) => button.textContent?.trim() === 'Пригласить',
    );

    for (const code of ['INVITATION_ALREADY_PENDING', 'ALREADY_MEMBER']) {
      mocks.invite.mockRejectedValueOnce(
        new ApiRequestError(409, { code, detail: `detail-${code}` }),
      );
      inviteButton?.click();
      await flushPromises();
      const emailInput = q<HTMLInputElement>('input[name="email"]');
      emailInput!.value = 'friend@example.test';
      emailInput!.dispatchEvent(new Event('input', { bubbles: true }));
      await flushPromises();
      q<HTMLFormElement>('[role="dialog"] form')?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await flushPromises();

      expect(text()).toContain(`detail-${code}`);
      q<HTMLButtonElement>('[data-testid="modal-close"]')?.click();
      await flushPromises();
    }
  });

  it('returns focus to "Пригласить" after closing the dialog', async () => {
    mountPage();
    await flushPromises();

    const inviteButton = qa<HTMLButtonElement>('button').find(
      (button) => button.textContent?.trim() === 'Пригласить',
    );
    inviteButton?.focus();
    inviteButton?.click();
    await flushPromises();

    q<HTMLButtonElement>('[data-testid="modal-close"]')?.click();
    await flushPromises();

    expect(document.activeElement).toBe(inviteButton);
  });
});
