import type { AuthorRef } from '../../composables/useEnvelopePlanV2.js';

export type { AuthorRef };

// The reader's gender toward a co-author is unknown, so every label stays
// gender-neutral: a bare name, or a name plus the fixed suffix below.
export function authorLabel(author: AuthorRef): string {
  const name = author.displayName ?? 'Участник';
  return author.isActiveMember ? name : `${name} (не в семье)`;
}
