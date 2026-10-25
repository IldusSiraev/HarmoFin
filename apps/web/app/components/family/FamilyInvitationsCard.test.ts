import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FamilyInvitationsCard from './FamilyInvitationsCard.vue';
import type { Invitation } from '../../composables/useFamily.js';

const pending: Invitation = {
  id: 'inv-1',
  email: 'friend@example.test',
  role: 'EDITOR',
  status: 'PENDING',
  expiresAt: '2026-11-01T00:00:00.000Z',
  createdAt: '2026-10-25T00:00:00.000Z',
};

const expired: Invitation = {
  ...pending,
  id: 'inv-2',
  status: 'EXPIRED',
};

describe('FamilyInvitationsCard', () => {
  it('shows the empty state with no invitations', () => {
    const wrapper = mount(FamilyInvitationsCard, { props: { invitations: [] } });
    expect(wrapper.text()).toContain('Приглашений нет');
  });

  it('shows email, role and expiry for a pending invitation', () => {
    const wrapper = mount(FamilyInvitationsCard, { props: { invitations: [pending] } });
    expect(wrapper.text()).toContain('friend@example.test');
    expect(wrapper.text()).toContain('Участник');
    expect(wrapper.text()).toContain('действует до');
  });

  it('shows "истекло" for an expired invitation', () => {
    const wrapper = mount(FamilyInvitationsCard, { props: { invitations: [expired] } });
    expect(wrapper.text()).toContain('истекло');
  });

  it('emits resend and revoke from the row menu', async () => {
    const wrapper = mount(FamilyInvitationsCard, { props: { invitations: [pending] } });

    await wrapper.get('[aria-label="Действия: приглашение friend@example.test"]').trigger('click');
    const items = wrapper.findAll('[role="menuitem"]');
    expect(items.map((item) => item.text())).toEqual(['Отправить повторно', 'Отозвать']);

    await items[0]!.trigger('click');
    expect(wrapper.emitted('resend')).toEqual([['inv-1']]);

    await wrapper.get('[aria-label="Действия: приглашение friend@example.test"]').trigger('click');
    await wrapper.get('[role="menuitem"]:last-child').trigger('click');
    expect(wrapper.emitted('revoke')).toEqual([['inv-1']]);
  });
});
