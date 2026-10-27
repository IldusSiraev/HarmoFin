import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';

import type { Member } from './useFamily.js';

const user = ref<{ id: string } | null>({ id: 'u-me' });
const members = ref<Member[]>([]);
const load = vi.fn();

vi.mock('./useActiveWorkspace.js', () => ({
  useActiveWorkspace: () => ({ workspace: computed(() => ({ id: 'ws-1', role: 'OWNER' })) }),
}));
vi.mock('./useAuth.js', () => ({
  useAuth: () => ({ currentUser: computed(() => user.value) }),
}));
vi.mock('./useFamily.js', () => ({
  useFamily: () => ({ members, load }),
}));

import { useOwnerFilter } from './useOwnerFilter.js';

function member(userId: string, displayName: string | null): Member {
  return {
    membershipId: `m-${userId}`,
    userId,
    email: `${userId}@test`,
    displayName,
    role: 'EDITOR',
    isCreator: userId === 'u-me',
    joinedAt: '2026-01-01T00:00:00.000Z',
  };
}

// useOwnerFilter loads members from onMounted, so it must run inside a real
// component instance — a bare call would never mount.
function setup(): ReturnType<typeof useOwnerFilter> {
  let result!: ReturnType<typeof useOwnerFilter>;
  mount(
    defineComponent({
      setup() {
        result = useOwnerFilter();
        return () => null;
      },
    }),
  );
  return result;
}

describe('useOwnerFilter', () => {
  beforeEach(() => {
    user.value = { id: 'u-me' };
    members.value = [];
    load.mockClear();
  });

  it('hides the filter for a single-member family', () => {
    members.value = [member('u-me', 'Я')];

    const filter = setup();

    expect(load).toHaveBeenCalledTimes(1);
    expect(filter.kind.value).toBe('none');
    expect(filter.ownerUserId.value).toBeUndefined();
  });

  it('offers «Все / Мои» for two members', () => {
    members.value = [member('u-me', 'Я'), member('u-alia', 'Алия')];

    const filter = setup();

    expect(filter.kind.value).toBe('toggle');
    expect(filter.options.value).toEqual([
      { value: 'all', label: 'Все' },
      { value: 'mine', label: 'Мои' },
    ]);
    filter.mode.value = 'mine';
    expect(filter.ownerUserId.value).toBe('u-me');
  });

  it('offers a chip per member for three or more', () => {
    members.value = [member('u-me', 'Я'), member('u-alia', 'Алия'), member('u-bob', 'Боб')];

    const filter = setup();

    expect(filter.kind.value).toBe('chip');
    expect(filter.options.value).toEqual([
      { value: 'all', label: 'Все' },
      { value: 'u-me', label: 'Мои' },
      { value: 'u-alia', label: 'Алия' },
      { value: 'u-bob', label: 'Боб' },
    ]);
    filter.mode.value = 'u-alia';
    expect(filter.ownerUserId.value).toBe('u-alia');
  });
});
