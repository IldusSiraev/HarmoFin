import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), requestBlob: vi.fn() }));

vi.mock('./useApiClient.js', async () => {
  const actual = await vi.importActual<typeof import('./useApiClient.js')>('./useApiClient.js');
  return { ...actual, useApiClient: () => mocks };
});

import { ApiRequestError } from './useApiClient.js';
import { useLandingSession } from './useLandingSession.js';

const me = {
  user: { id: 'user-1', email: 'owner@example.com', displayName: null },
  workspaces: [],
  pendingConsents: [],
};

function mountHost() {
  let session!: ReturnType<typeof useLandingSession>;
  const wrapper = mount(
    defineComponent({
      setup() {
        session = useLandingSession();
        return () => h('div');
      },
    }),
  );
  return { wrapper, session: () => session };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  await nextTick();
}

describe('useLandingSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays pending until the session check finishes', () => {
    mocks.request.mockReturnValue(new Promise(() => {}));
    const { session } = mountHost();

    expect(session().status.value).toBe('pending');
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/me');
  });

  it('reports an authenticated visitor when /me succeeds', async () => {
    mocks.request.mockResolvedValue(me);
    const { session } = mountHost();

    await settle();

    expect(session().status.value).toBe('authenticated');
  });

  it('reports a guest when /me is rejected', async () => {
    mocks.request.mockRejectedValue(
      new ApiRequestError(401, { code: 'UNAUTHENTICATED', detail: 'Требуется вход.' }),
    );
    const { session } = mountHost();

    await settle();

    expect(session().status.value).toBe('guest');
  });
});
