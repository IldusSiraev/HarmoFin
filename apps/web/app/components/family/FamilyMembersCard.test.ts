import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FamilyMembersCard from './FamilyMembersCard.vue';
import type { Member } from '../../composables/useFamily.js';

const creator: Member = {
  membershipId: 'm-owner',
  userId: 'u-owner',
  email: 'owner@example.test',
  displayName: 'Иван',
  role: 'OWNER',
  isCreator: true,
  joinedAt: '2026-01-01T00:00:00.000Z',
};

const editor: Member = {
  membershipId: 'm-editor',
  userId: 'u-editor',
  email: 'aliya@example.test',
  displayName: 'Алия',
  role: 'EDITOR',
  isCreator: false,
  joinedAt: '2026-01-02T00:00:00.000Z',
};

describe('FamilyMembersCard', () => {
  it('shows the creator role label and member role text', () => {
    const wrapper = mount(FamilyMembersCard, {
      props: { members: [creator, editor], canManage: true },
    });

    expect(wrapper.text()).toContain('Создатель');
    expect(wrapper.text()).toContain('Участник');
  });

  it('shows an action menu for a non-creator row when the viewer can manage', () => {
    const wrapper = mount(FamilyMembersCard, {
      props: { members: [creator, editor], canManage: true },
    });

    const rows = wrapper.findAll('[aria-label="Действия: Алия"]');
    expect(rows).toHaveLength(1);
    expect(wrapper.find('[aria-label="Действия: Иван"]').exists()).toBe(false);
  });

  it('hides every menu when the viewer cannot manage', () => {
    const wrapper = mount(FamilyMembersCard, {
      props: { members: [creator, editor], canManage: false },
    });

    expect(wrapper.find('[aria-label="Действия: Алия"]').exists()).toBe(false);
  });

  it('emits changeRole and remove from the menu actions', async () => {
    const wrapper = mount(FamilyMembersCard, {
      props: { members: [creator, editor], canManage: true },
    });

    await wrapper.get('[aria-label="Действия: Алия"]').trigger('click');
    const items = wrapper.findAll('[role="menuitem"]');
    expect(items.map((item) => item.text())).toEqual([
      'Сделать наблюдателем',
      'Удалить из семьи',
    ]);

    await items[0]!.trigger('click');
    expect(wrapper.emitted('changeRole')).toEqual([['m-editor', 'VIEWER']]);

    await wrapper.get('[aria-label="Действия: Алия"]').trigger('click');
    await wrapper.get('[role="menuitem"]:last-child').trigger('click');
    expect(wrapper.emitted('remove')).toEqual([[editor]]);
  });
});
