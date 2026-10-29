import type { PersonRef } from '../../composables/useEnvelopePlanV2.js';

export type { PersonRef };
// Compatibility alias for imports written before the owner signature appeared.
export type AuthorRef = PersonRef;

// The reader's gender toward a co-author is unknown, so every label stays
// gender-neutral: a bare name, or a name plus the fixed suffix below.
export function authorLabel(author: PersonRef): string {
  const name = author.displayName ?? 'Участник';
  return author.isActiveMember ? name : `${name} (не в семье)`;
}
