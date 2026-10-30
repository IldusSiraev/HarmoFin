import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const feed = vi.hoisted(() => ({ list: vi.fn(), markSeen: vi.fn(), unseenCount: { value: null } }));
vi.mock('#imports', () => ({ navigateTo: vi.fn() }));
vi.mock('../../composables/useActivityFeed.js', () => ({
  useActivityFeed: () => ({ ...feed, unseenCount: ref(feed.unseenCount.value) }),
}));

import FamilyActivityCard from './FamilyActivityCard.vue';

const alia = { userId: 'alia', displayName: 'Алия', isActiveMember: true };
const response = (overrides = {}) => ({
  seenAt: null,
  newSince: '2026-10-23T00:00:00.000Z',
  unseenCount: 2,
  people: [alia],
  items: [
    {
      id: 'audit-1',
      occurredAt: new Date().toISOString(),
      kind: 'CALENDAR_EVENT_CREATED',
      isNew: true,
      actor: alia,
      amountMinor: null,
      currency: 'RUB',
      transactionType: null,
      title: 'Родительское собрание',
      details: [],
      target: null,
      link: { type: 'CALENDAR_EVENT', id: 'e', date: '2026-11-05' },
    },
  ],
  nextCursor: null,
  ...overrides,
});

const mountCard = () =>
  mount(FamilyActivityCard, {
    props: { budgetId: 'budget-id' },
    global: { stubs: { NuxtLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } } },
  });

beforeEach(() => {
  feed.list.mockReset();
  feed.markSeen.mockReset();
});

describe('FamilyActivityCard', () => {
  it('reads five items, shows the new count and links to the feed, without marking it seen', async () => {
    feed.list.mockResolvedValue(response());
    const wrapper = mountCard();
    await flushPromises();
    expect(feed.list).toHaveBeenCalledWith('budget-id', { limit: 5 });
    expect(wrapper.text()).toContain('Что нового в семье');
    expect(wrapper.text()).toContain('2 новых');
    expect(wrapper.text()).toContain('Алия · новое событие');
    expect(wrapper.find('a[href="/app/activity"]').text()).toContain('Все события');
    expect(feed.markSeen).not.toHaveBeenCalled();
  });

  it('says it is quiet when the family did nothing', async () => {
    feed.list.mockResolvedValue(response({ items: [], unseenCount: 0 }));
    const wrapper = mountCard();
    await flushPromises();
    expect(wrapper.text()).toContain('Пока тихо — семья ничего не меняла.');
    expect(wrapper.text()).not.toContain('новых');
  });

  it('stays hidden for a single-person budget and when the request fails', async () => {
    feed.list.mockResolvedValue(response({ people: [] }));
    const single = mountCard();
    await flushPromises();
    expect(single.find('[data-testid="family-activity-card"]').exists()).toBe(false);

    feed.list.mockRejectedValue(new Error('offline'));
    const failed = mountCard();
    await flushPromises();
    expect(failed.find('[data-testid="family-activity-card"]').exists()).toBe(false);
  });
});
