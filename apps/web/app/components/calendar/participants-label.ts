import type { PersonRef } from '../../composables/useEnvelopePlanV2.js';
import { authorLabel } from '../operations/author-label.js';

export function participantsLabel(
  people: readonly PersonRef[],
  activeMemberIds: ReadonlySet<string>,
): string {
  if (people.length === 0) return '';
  const active = people.filter((person) => person.isActiveMember).map((person) => person.userId);
  const everyone =
    activeMemberIds.size > 1 &&
    active.length === people.length &&
    [...activeMemberIds].every((id) => active.includes(id));
  return everyone ? 'Вся семья' : people.map((person) => authorLabel(person)).join(', ');
}
