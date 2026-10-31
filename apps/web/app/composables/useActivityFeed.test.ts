import { ref, type Ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
const states = new Map<string, Ref<unknown>>();
vi.mock('./useApiClient.js', () => ({ useApiClient: () => ({ request }) }));
vi.mock('#imports', () => ({
  useState: <T>(key: string, init: () => T) => {
    if (!states.has(key)) states.set(key, ref(init()));
    return states.get(key) as Ref<T>;
  },
}));

import { useActivityFeed } from './useActivityFeed.js';

const page = {
  seenAt: null,
  newSince: '2026-10-23T10:00:00.000Z',
  unseenCount: 3,
  people: [],
  items: [],
  nextCursor: null,
};

beforeEach(() => {
  request.mockReset();
  states.clear();
});

describe('useActivityFeed', () => {
  it('reads the feed with the query and shares the unseen count', async () => {
    request.mockResolvedValue(page);
    await useActivityFeed().list('budget id', { limit: 5, actorId: 'user-1', cursor: 'abc' });
    expect(request).toHaveBeenCalledWith(
      '/api/v2/budgets/budget%20id/activity?limit=5&actorId=user-1&cursor=abc',
    );
    expect(useActivityFeed().unseenCount.value).toBe(3);
  });

  it('reads without a query string when nothing is set', async () => {
    request.mockResolvedValue(page);
    await useActivityFeed().list('budget-id');
    expect(request).toHaveBeenCalledWith('/api/v2/budgets/budget-id/activity');
  });

  it('keeps the previous unseen count when the read fails', async () => {
    request.mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('offline'));
    const feed = useActivityFeed();
    await feed.list('budget-id');
    await expect(feed.list('budget-id')).rejects.toThrow('offline');
    expect(feed.unseenCount.value).toBe(3);
  });

  it('marks the feed seen and clears the shared count', async () => {
    request.mockResolvedValueOnce(page).mockResolvedValueOnce({ seenAt: '2026-10-30T10:00:00Z' });
    const feed = useActivityFeed();
    await feed.list('budget-id');
    await feed.markSeen('budget-id');
    expect(request).toHaveBeenLastCalledWith('/api/v2/budgets/budget-id/activity/seen', {
      method: 'POST',
    });
    expect(useActivityFeed().unseenCount.value).toBe(0);
  });
});
