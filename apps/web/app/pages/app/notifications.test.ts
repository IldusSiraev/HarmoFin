import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
};
const auth = {
  currentData: { value: { workspaces: [{ budgets: [{ id: 'budget-id' }] }] } },
  loadMe: vi.fn(),
};
const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));

vi.mock('#imports', () => ({ definePageMeta: vi.fn(), navigateTo }));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useBudgetReferenceData.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBudgetReferenceData: () => api,
}));

import NotificationsPage from './notifications.vue';

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

describe('notifications page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listNotifications.mockResolvedValue({ items: [notification], nextCursor: null });
    api.markNotificationRead.mockResolvedValue({
      ...notification,
      readAt: '2026-09-10T12:01:00.000Z',
    });
  });

  it('marks notification read before following server action path', async () => {
    const wrapper = mount(NotificationsPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    await wrapper.get('[data-action="notification-link"]').trigger('click');
    await flushPromises();

    expect(api.markNotificationRead).toHaveBeenCalledWith(
      'budget-id',
      'notification-id',
      expect.any(String),
    );
    expect(navigateTo).toHaveBeenCalledWith('/app/plans?occurrence=occurrence-id');
  });

  it('offers retry after a loading error', async () => {
    api.listNotifications.mockRejectedValueOnce(new Error('network'));
    const wrapper = mount(NotificationsPage);
    await flushPromises();

    expect(wrapper.text()).toContain('Не удалось загрузить уведомления. Повторите попытку.');
    await wrapper.get('[data-action="retry-notifications"]').trigger('click');
    expect(api.listNotifications).toHaveBeenCalledTimes(2);
  });

  it('marks all unread notifications and reports server result', async () => {
    api.markAllNotificationsRead.mockResolvedValue({ updatedCount: 1 });
    const wrapper = mount(NotificationsPage, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    await flushPromises();

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(api.markAllNotificationsRead).toHaveBeenCalledWith('budget-id', expect.any(String));
    expect(wrapper.text()).toContain('Все уведомления отмечены прочитанными.');
    expect(wrapper.text()).toContain('Прочитано');
  });

  it('renders unread state with text', async () => {
    const wrapper = mount(NotificationsPage);
    await flushPromises();

    expect(wrapper.text()).toContain('Новое');
  });
});
