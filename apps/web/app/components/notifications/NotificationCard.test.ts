import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import NotificationCard from './NotificationCard.vue';

const notification = {
  id: 'notification-id',
  budgetId: 'budget-id',
  notificationType: 'PLAN_TODAY' as const,
  occurrenceId: 'occurrence-id',
  relatedEntityType: null,
  relatedEntityId: null,
  title: 'Плановый платёж сегодня',
  body: 'Сегодня запланировано: «Ипотека».',
  actionPath: '/app/plans?occurrence=occurrence-id',
  readAt: null,
  resolvedAt: null,
  createdAt: '2026-09-10T12:00:00.000Z',
};

describe('NotificationCard', () => {
  it('renders unread text status and action link', () => {
    const wrapper = mount(NotificationCard, {
      props: { notification },
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });

    expect(wrapper.text()).toContain('Новое');
    expect(wrapper.text()).toContain('Плановый платёж сегодня');
    expect(wrapper.get('a[href="/app/plans?occurrence=occurrence-id"]')).toBeTruthy();
  });
});
