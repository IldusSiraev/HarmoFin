import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const feed = vi.hoisted(() => ({ list: vi.fn(), markSeen: vi.fn() }));
const auth = {
  currentData: { value: { workspaces: [{ id: 'ws', budgets: [{ id: 'budget-id' }] }] } },
  loadMe: vi.fn(),
};
vi.mock('#imports', () => ({ definePageMeta: vi.fn(), navigateTo: vi.fn() }));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../../composables/useActivityFeed.js', () => ({
  useActivityFeed: () => ({ ...feed, unseenCount: ref(null) }),
}));

import ActivityPage from './activity.vue';

const alia = { userId: 'alia', displayName: 'Алия', isActiveMember: true };
const igor = { userId: 'igor', displayName: 'Игорь', isActiveMember: true };
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const item = (id: string, occurredAt: string, actor = alia) => ({
  id,
  occurredAt,
  kind: 'CALENDAR_EVENT_CREATED',
  isNew: false,
  actor,
  amountMinor: null,
  currency: 'RUB',
  transactionType: null,
  title: `Событие ${id}`,
  details: [],
  target: null,
  link: null,
});
const page = (overrides = {}) => ({
  seenAt: hoursAgo(2),
  newSince: hoursAgo(2),
  unseenCount: 1,
  people: [alia, igor],
  items: [item('fresh', hoursAgo(1)), item('old', hoursAgo(50))],
  nextCursor: null,
  ...overrides,
});

beforeEach(() => {
  feed.list.mockReset();
  feed.markSeen.mockReset();
  feed.markSeen.mockResolvedValue({ seenAt: new Date().toISOString() });
});

describe('activity page', () => {
  it('splits new from earlier by the first boundary, then marks the feed seen', async () => {
    feed.list.mockResolvedValue(page());
    const wrapper = mount(ActivityPage);
    await flushPromises();
    const news = wrapper.find('[data-testid="activity-new"]');
    expect(news.text()).toContain('Событие fresh');
    expect(news.text()).not.toContain('Событие old');
    expect(wrapper.find('[data-testid="activity-earlier"]').text()).toContain('Событие old');
    expect(feed.markSeen).toHaveBeenCalledWith('budget-id');
    expect(feed.markSeen.mock.invocationCallOrder[0]).toBeGreaterThan(
      feed.list.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps the split after a filter change and marks seen only once', async () => {
    feed.list.mockResolvedValueOnce(page()).mockResolvedValueOnce(
      page({
        seenAt: new Date().toISOString(),
        newSince: new Date().toISOString(),
        items: [item('fresh', hoursAgo(1))],
      }),
    );
    const wrapper = mount(ActivityPage);
    await flushPromises();
    await wrapper.findComponent({ name: 'UiFilterBar' }).vm.$emit('change', 'actor', 'alia');
    await flushPromises();
    expect(feed.list).toHaveBeenLastCalledWith('budget-id', { actorId: 'alia' });
    expect(wrapper.find('[data-testid="activity-new"]').text()).toContain('Событие fresh');
    expect(feed.markSeen).toHaveBeenCalledTimes(1);
  });

  it('loads more with the cursor', async () => {
    feed.list
      .mockResolvedValueOnce(page({ nextCursor: 'next' }))
      .mockResolvedValueOnce(page({ items: [item('older', hoursAgo(80))], nextCursor: null }));
    const wrapper = mount(ActivityPage);
    await flushPromises();
    await wrapper.find('[data-testid="activity-more"]').trigger('click');
    await flushPromises();
    expect(feed.list).toHaveBeenLastCalledWith('budget-id', { cursor: 'next' });
    expect(wrapper.text()).toContain('Событие older');
    expect(wrapper.find('[data-testid="activity-more"]').exists()).toBe(false);
  });

  it('shows an empty state and a retry on failure; a failed mark is silent', async () => {
    feed.list.mockResolvedValueOnce(page({ items: [], unseenCount: 0 }));
    feed.markSeen.mockRejectedValueOnce(new Error('offline'));
    const empty = mount(ActivityPage);
    await flushPromises();
    expect(empty.text()).toContain('За 30 дней семья ничего не меняла');

    feed.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page());
    const failed = mount(ActivityPage);
    await flushPromises();
    expect(failed.text()).toContain('Не удалось загрузить ленту');
    await failed.find('[data-testid="activity-retry"]').trigger('click');
    await flushPromises();
    expect(failed.text()).toContain('Событие fresh');
  });

  it('keeps rows and shows an inline alert when loading more fails', async () => {
    feed.list
      .mockResolvedValueOnce(page({ nextCursor: 'next' }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page({ items: [item('older', hoursAgo(80))], nextCursor: null }));
    const wrapper = mount(ActivityPage);
    await flushPromises();
    await wrapper.find('[data-testid="activity-more"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('Не удалось загрузить ещё');
    expect(wrapper.text()).toContain('Событие fresh');
    await wrapper.find('[data-testid="activity-more-retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Событие older');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('drops rows and offers a retry when a filter change fails', async () => {
    feed.list.mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error('offline'));
    const wrapper = mount(ActivityPage);
    await flushPromises();
    await wrapper.findComponent({ name: 'UiFilterBar' }).vm.$emit('change', 'actor', 'igor');
    await flushPromises();
    expect(wrapper.text()).toContain('Не удалось загрузить ленту');
    expect(wrapper.text()).not.toContain('Событие fresh');
    expect(wrapper.find('[data-testid="activity-retry"]').exists()).toBe(true);
  });

  it('shows a filter-specific empty text and announces the result', async () => {
    feed.list
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page({ items: [], unseenCount: 0 }));
    const wrapper = mount(ActivityPage);
    await flushPromises();
    expect(wrapper.find('[role="status"]').text()).toBe('Показано событий: 2');
    await wrapper.findComponent({ name: 'UiFilterBar' }).vm.$emit('change', 'actor', 'igor');
    await flushPromises();
    expect(wrapper.text()).toContain('У этого участника нет событий');
    expect(wrapper.text()).not.toContain('За 30 дней семья ничего не меняла');
    expect(wrapper.find('[role="status"]').text()).toBe('Событий нет');
  });

  it('ignores a stale response that resolves after a newer one', async () => {
    let resolveOld: (value: unknown) => void = () => undefined;
    feed.list
      .mockResolvedValueOnce(page())
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce(page({ items: [item('latest', hoursAgo(1))] }));
    const wrapper = mount(ActivityPage);
    await flushPromises();
    const bar = wrapper.findComponent({ name: 'UiFilterBar' });
    bar.vm.$emit('change', 'actor', 'alia');
    bar.vm.$emit('change', 'actor', 'igor');
    await flushPromises();
    resolveOld(page({ items: [item('stale', hoursAgo(1))] }));
    await flushPromises();
    expect(wrapper.text()).toContain('Событие latest');
    expect(wrapper.text()).not.toContain('Событие stale');
  });
});
