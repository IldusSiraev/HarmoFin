import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FamilyInviteDialog from './FamilyInviteDialog.vue';

const wrappers: Array<{ unmount: () => void }> = [];

function mountDialog(props: Record<string, unknown> = {}) {
  const wrapper = mount(FamilyInviteDialog, {
    props: {
      open: true,
      pending: false,
      sent: null,
      error: null,
      ...props,
    },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}

const text = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);

afterEach(() => {
  while (wrappers.length > 0) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('FamilyInviteDialog', () => {
  it('shows the email and role form by default', () => {
    mountDialog();
    expect(q('input[name="email"]')).not.toBeNull();
    expect(text()).toContain('Участник записывает операции и распределяет деньги.');
  });

  it('emits submit with the trimmed email and selected role', async () => {
    const wrapper = mountDialog();

    const emailInput = q<HTMLInputElement>('input[name="email"]');
    emailInput!.value = '  friend@example.test  ';
    emailInput!.dispatchEvent(new Event('input', { bubbles: true }));
    q<HTMLButtonElement>('[aria-pressed="false"]')?.click();
    await flushPromises();
    q<HTMLFormElement>('form')?.requestSubmit();
    await flushPromises();

    expect(wrapper.emitted('submit')).toEqual([['friend@example.test', 'VIEWER']]);
  });

  it('shows the field error from an API code at the email field', () => {
    mountDialog({
      error: { code: 'INVITATION_ALREADY_PENDING', detail: 'Приглашение уже отправлено.' },
    });
    expect(text()).toContain('Приглашение уже отправлено.');
  });

  it('shows the sent state with a readonly, named invite link', () => {
    mountDialog({
      sent: {
        id: 'inv-1',
        email: 'friend@example.test',
        role: 'EDITOR',
        status: 'PENDING',
        expiresAt: '2026-11-01T00:00:00.000Z',
        createdAt: '2026-10-25T00:00:00.000Z',
        inviteUrl: 'https://harmofin.test/invite/abc',
      },
    });

    expect(text()).toContain('Письмо отправлено на friend@example.test');
    const link = q<HTMLInputElement>('input[name="inviteUrl"]');
    expect(link).not.toBeNull();
    expect(link!.readOnly).toBe(true);
    expect(q('label[for="inviteUrl-input"]')?.textContent).toBe('Ссылка-приглашение');
    expect(text()).toContain('Ссылка показывается один раз');
  });

  it('copies the invite link and shows confirmation text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    mountDialog({
      sent: {
        id: 'inv-1',
        email: 'friend@example.test',
        role: 'EDITOR',
        status: 'PENDING',
        expiresAt: '2026-11-01T00:00:00.000Z',
        createdAt: '2026-10-25T00:00:00.000Z',
        inviteUrl: 'https://harmofin.test/invite/abc',
      },
    });

    q<HTMLButtonElement>('[data-testid="family-invite-copy"]')?.click();
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith('https://harmofin.test/invite/abc');
    expect(text()).toContain('Скопировано');
  });
});
