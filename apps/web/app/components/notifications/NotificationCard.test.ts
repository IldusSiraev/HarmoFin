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
    expect(wrapper.find('.notification-card__icon').exists()).toBe(false);
    expect(wrapper.find('[data-testid="notification-type-caption"]').exists()).toBe(false);
  });

  it('shows an aria-hidden icon for a member access event', () => {
    const wrapper = mount(NotificationCard, {
      props: {
        notification: {
          ...notification,
          notificationType: 'MEMBER_JOINED',
          title: 'Новый участник семьи',
          body: 'Анна присоединилась к семье «Сираевы».',
          actionPath: '/app/settings/family',
        },
      },
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });

    const icon = wrapper.get('.notification-card__icon');
    expect(icon.attributes('aria-hidden')).toBe('true');
    expect(wrapper.text()).toContain('Новый участник семьи');
    expect(wrapper.get('[data-testid="notification-type-caption"]').text()).toBe('Семья');
  });

  it('shows the transferred-objects event as a family event with its icon and caption', () => {
    const wrapper = mount(NotificationCard, {
      props: {
        notification: {
          ...notification,
          notificationType: 'OBJECTS_TRANSFERRED',
          title: 'Вам переданы 3 счёта, 2 плана',
          body: 'Участник «Борис» больше не в семье. Переданные объекты принадлежат вам.',
          actionPath: '/app/accounts',
          occurrenceId: null,
          relatedEntityType: 'workspace_membership',
          relatedEntityId: 'membership-id',
        },
      },
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });

    expect(wrapper.find('.notification-card__icon').attributes('aria-hidden')).toBe('true');
    expect(wrapper.get('[data-testid="notification-type-caption"]').text()).toBe('Семья');
    expect(wrapper.text()).toContain('Вам переданы 3 счёта, 2 плана');
    expect(wrapper.get('a[href="/app/accounts"]')).toBeTruthy();
    // Суммы в этом типе уведомления нет: карточка не печатает ни одной
    // отформатированной суммы (FinanceMoney рисует знак валюты в тексте).
    expect(wrapper.text()).not.toMatch(/₽|€|\$|RUB/);
  });
});
