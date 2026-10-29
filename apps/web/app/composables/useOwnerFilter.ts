import { computed, onMounted, ref, type ComputedRef, type Ref } from 'vue';

import { authorLabel } from '../components/operations/author-label.js';
import { useActiveWorkspace } from './useActiveWorkspace.js';
import { type Member, useFamily } from './useFamily.js';
import { usePermissions } from './usePermissions.js';

export type OwnerFilterOption = { value: string; label: string };
export type OwnerFilterKind = 'none' | 'toggle' | 'chip';

// 'all' | 'mine' for the two-value toggle; anything else is a member userId.
type Mode = 'all' | 'mine' | (string & {});

export function useOwnerFilter(): {
  mode: Ref<Mode>;
  ownerUserId: ComputedRef<string | undefined>;
  options: ComputedRef<OwnerFilterOption[]>;
  kind: ComputedRef<OwnerFilterKind>;
} {
  const { workspace } = useActiveWorkspace();
  const { userId } = usePermissions();
  const { members, load } = useFamily(computed(() => workspace.value?.id));

  onMounted(() => {
    void load();
  });

  const kind = computed<OwnerFilterKind>(() => {
    // With a single member there is nothing to filter by, so the control is
    // hidden entirely instead of showing a two-option toggle with no choice.
    const count = members.value.length;
    return count < 2 ? 'none' : count === 2 ? 'toggle' : 'chip';
  });

  const options = computed<OwnerFilterOption[]>(() => {
    if (kind.value !== 'chip') {
      return [
        { value: 'all', label: 'Все' },
        { value: 'mine', label: 'Мои' },
      ];
    }
    // The members endpoint lists current members only, so the author label
    // always gets an active person reference.
    const person = (member: Member) => ({
      userId: member.userId,
      displayName: member.displayName,
      isActiveMember: true,
    });
    return [
      { value: 'all', label: 'Все' },
      ...members.value.map((member) => ({
        value: member.userId,
        label: member.userId === userId.value ? 'Мои' : authorLabel(person(member)),
      })),
    ];
  });

  const mode = ref<Mode>('all');

  const ownerUserId = computed<string | undefined>(() => {
    if (mode.value === 'all') return undefined;
    if (mode.value === 'mine') return userId.value ?? undefined;
    return mode.value;
  });

  return { mode, ownerUserId, options, kind };
}
